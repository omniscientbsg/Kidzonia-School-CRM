// Task reporting. Every rollup is computed here, server-side, over the set of
// instances the caller may actually see — HQ sees every school, a principal
// sees only her own subtree. The client cannot widen that by changing a filter.
import { list, find } from '../db.js'
import { buildOrgIndex, positionsOfUser, canManagePosition, describePosition, subtreeNodeIds } from '../org/tree.js'
import { OPEN_STATUSES } from './model.js'
import { isGatingNow } from './gate.js'
import { localToday, addDays, daysBetween, DEFAULT_TZ } from './time.js'

const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0)
const hours = (from, to) => (Date.parse(to) - Date.parse(from)) / 3600000

// Same visibility rule the instance list uses: mine, assigned by me, or anyone
// below me in the tree.
function visible(user, inst, idx, mine) {
  if (inst.assigneeUserId === user.id || inst.assignedByUserId === user.id) return true
  const pos = idx.positionById.get(inst.assigneePositionId)
  return !!pos && mine.some((m) => canManagePosition(m, pos, idx))
}

function bucket(map, key, seed) {
  if (!map.has(key)) map.set(key, { ...seed, total: 0, done: 0, open: 0, overdue: 0, awaitingApproval: 0, cancelled: 0, sentBack: 0 })
  return map.get(key)
}

function tally(row, inst) {
  row.total++
  if (inst.status === 'approved') row.done++
  else if (inst.status === 'overdue') { row.overdue++; row.open++ }
  else if (inst.status === 'submitted') row.awaitingApproval++
  else if (inst.status === 'cancelled') row.cancelled++
  else if (OPEN_STATUSES.includes(inst.status)) row.open++
  // a rejection is no longer a status of its own — the work went straight back
  // to in_progress — so "sent back" is counted from the rejection itself
  if (inst.rejectionCount > 0) row.sentBack = (row.sentBack || 0) + 1
}

const withPct = (rows) => rows.map((r) => ({ ...r, pct: pct(r.done, r.total - r.cancelled) }))

// A day counts toward a streak when it had work and none of it was left open.
// Cancelled occurrences are ignored; submitted counts (the assignee did their
// part — approval is someone else's clock).
function streaks(rows, tz) {
  const byDay = new Map()
  for (const i of rows) {
    if (i.status === 'cancelled') continue
    if (!byDay.has(i.serviceDate)) byDay.set(i.serviceDate, { total: 0, open: 0 })
    const d = byDay.get(i.serviceDate)
    d.total++
    if (OPEN_STATUSES.includes(i.status)) d.open++
  }
  const today = localToday(tz)
  const clean = (day) => byDay.has(day) && byDay.get(day).total > 0 && byDay.get(day).open === 0

  // current streak may end today or yesterday — today is not over yet
  let cursor = clean(today) ? today : addDays(today, -1)
  let current = 0
  while (clean(cursor)) { current++; cursor = addDays(cursor, -1) }

  let longest = 0
  let run = 0
  for (const day of [...byDay.keys()].sort()) {
    if (clean(day)) { run++; longest = Math.max(longest, run) } else run = 0
  }
  return { current, longest, daysTracked: byDay.size }
}

export function buildAnalytics(user, query = {}) {
  const idx = buildOrgIndex()
  const mine = positionsOfUser(user, idx)
  const myTz = idx.nodeById.get(mine[0]?.nodeId)?.timezone || DEFAULT_TZ
  const today = localToday(myTz)
  const from = query.from || addDays(today, -30)
  const to = query.to || today

  const tasksById = new Map(list('tasks').map((t) => [t.id, t]))
  let rows = list('taskInstances').filter((i) => visible(user, i, idx, mine))

  // scope narrowing (never widening): a node filter is intersected with the
  // subtree, so passing a node you cannot see yields nothing rather than more
  if (query.nodeId) {
    const ids = new Set(subtreeNodeIds(query.nodeId, idx))
    rows = rows.filter((i) => ids.has(i.assigneeNodeId))
  }
  if (query.levelId) {
    rows = rows.filter((i) => idx.positionById.get(i.assigneePositionId)?.levelId === query.levelId)
  }
  if (query.status) {
    const wanted = String(query.status).split(',')
    rows = rows.filter((i) => wanted.includes(i.status))
  }
  if (query.recurring === 'true' || query.recurring === 'false') {
    const wantRecurring = query.recurring === 'true'
    rows = rows.filter((i) => {
      const freq = tasksById.get(i.taskId)?.recurrence?.freq || 'none'
      return wantRecurring ? freq !== 'none' : freq === 'none'
    })
  }
  if (query.categoryId) rows = rows.filter((i) => tasksById.get(i.taskId)?.categoryId === query.categoryId)

  // Cancelled occurrences are not work: they would depress every completion
  // figure. They stay visible only when explicitly filtered for.
  const dated = rows.filter((i) => i.serviceDate >= from && i.serviceDate <= to)
  const inRange = query.status ? dated : dated.filter((i) => i.status !== 'cancelled')

  // ---- assignee view (always present, even for HQ: everyone has own work) ---
  const myRows = inRange.filter((i) => i.assigneeUserId === user.id)
  const myAll = rows.filter((i) => i.assigneeUserId === user.id)
  const myDone = myRows.filter((i) => i.status === 'approved').length
  const myCancelled = myRows.filter((i) => i.status === 'cancelled').length
  const me = {
    total: myRows.length,
    done: myDone,
    open: myRows.filter((i) => OPEN_STATUSES.includes(i.status)).length,
    overdue: myRows.filter((i) => i.status === 'overdue').length,
    awaitingApproval: myRows.filter((i) => i.status === 'submitted').length,
    completionPct: pct(myDone, myRows.length - myCancelled),
    streak: streaks(myAll, myTz),
    blockingOpen: myAll.filter((i) => isGatingNow(i, idx)).length,
  }

  // ---- manager rollups -----------------------------------------------------
  const teamRows = inRange.filter((i) => i.assigneeUserId !== user.id)
  const byPerson = new Map()
  const byTier = new Map()
  const byNode = new Map()

  for (const i of teamRows) {
    const pos = idx.positionById.get(i.assigneePositionId)
    const described = pos ? describePosition(pos, idx) : null
    const level = pos?.levelId ? idx.levelById.get(pos.levelId) : null
    tally(bucket(byPerson, i.assigneePositionId, {
      positionId: i.assigneePositionId, userId: i.assigneeUserId,
      userName: i.assigneeName || described?.userName || 'Unknown',
      tier: described?.tier || '—', nodeName: described?.nodeName || '', depth: described?.depth ?? null,
    }), i)
    tally(bucket(byTier, level?.id || 'none', { levelId: level?.id || null, tier: level?.name || 'Unassigned', rank: level?.rank ?? 999 }), i)
    const node = idx.nodeById.get(i.assigneeNodeId)
    tally(bucket(byNode, i.assigneeNodeId, {
      nodeId: i.assigneeNodeId, nodeName: node?.name || '—', nodeType: node?.type || null,
      isFranchise: !!node?.isFranchise, depth: node?.depth ?? null,
    }), i)
  }

  // ---- approval turnaround: submitted -> decided ---------------------------
  // Measured off the approval records, not the instances: a rejection clears
  // submittedAt from the row (the work is live again), so instance-based maths
  // would count approvals only and flatter the numbers.
  const inRangeIds = new Set(inRange.map((i) => i.id))
  const decisions = list('taskApprovals').filter((a) => inRangeIds.has(a.instanceId) && a.submittedAt && a.decidedAt)
  const durations = decisions.map((a) => hours(a.submittedAt, a.decidedAt)).sort((a, b) => a - b)
  const at = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] : null)
  const byApprover = new Map()
  for (const a of decisions) {
    const key = a.approverUserId
    if (!byApprover.has(key)) {
      byApprover.set(key, { userId: key, userName: find('users', key)?.name || 'Unknown', decisions: 0, approved: 0, rejected: 0, overrides: 0, totalHours: 0 })
    }
    const row = byApprover.get(key)
    row.decisions++
    if (a.decision === 'approved') row.approved++
    else row.rejected++
    if (a.viaOverride) row.overrides++
    row.totalHours += Math.max(0, hours(a.submittedAt, a.decidedAt))
  }

  const approvalTurnaround = {
    decisions: durations.length,
    avgHours: durations.length ? Number((durations.reduce((s, h) => s + h, 0) / durations.length).toFixed(1)) : null,
    medianHours: durations.length ? Number(at(0.5).toFixed(1)) : null,
    p90Hours: durations.length ? Number(at(0.9).toFixed(1)) : null,
    pendingNow: rows.filter((i) => i.status === 'submitted').length,
    oldestPendingHours: (() => {
      const pending = rows.filter((i) => i.status === 'submitted' && i.submittedAt)
      if (!pending.length) return null
      return Number(Math.max(...pending.map((i) => hours(i.submittedAt, new Date().toISOString()))).toFixed(1))
    })(),
    byApprover: [...byApprover.values()]
      .map((r) => ({ ...r, avgHours: r.decisions ? Number((r.totalHours / r.decisions).toFixed(1)) : null }))
      .sort((a, b) => b.decisions - a.decisions),
  }

  // ---- who is blocked right now -------------------------------------------
  // open MANDATORY work due today or earlier: these people cannot log out, and
  // if it is from an earlier day the API has already frozen their writes.
  const blockedNow = []
  const blockedBy = new Map()
  for (const i of rows) {
    if (!isGatingNow(i, idx)) continue          // same predicate the gate uses
    const tz = i.tz || DEFAULT_TZ
    const localNow = localToday(tz)
    const key = i.assigneeUserId
    if (!blockedBy.has(key)) {
      const pos = idx.positionById.get(i.assigneePositionId)
      const described = pos ? describePosition(pos, idx) : null
      blockedBy.set(key, {
        userId: key, userName: i.assigneeName || described?.userName || 'Unknown',
        tier: described?.tier || '—', nodeName: described?.nodeName || '',
        isSelf: key === user.id, count: 0, oldestDate: i.serviceDate, armed: false, titles: [],
      })
      blockedNow.push(blockedBy.get(key))
    }
    const row = blockedBy.get(key)
    row.count++
    if (i.serviceDate < row.oldestDate) row.oldestDate = i.serviceDate
    if (i.serviceDate < localNow) row.armed = true          // writes already frozen for them
    if (row.titles.length < 4) row.titles.push(i.title)
    row.daysStuck = daysBetween(row.oldestDate, localNow)
  }
  blockedNow.sort((a, b) => Number(b.armed) - Number(a.armed) || b.daysStuck - a.daysStuck || b.count - a.count)

  // ---- completion over time ------------------------------------------------
  const series = []
  const span = Math.min(180, Math.max(1, daysBetween(from, to) + 1))
  for (let d = 0; d < span; d++) {
    const day = addDays(from, d)
    const dayRows = inRange.filter((i) => i.serviceDate === day)
    if (!dayRows.length && span > 60) continue                // keep long ranges readable
    const done = dayRows.filter((i) => i.status === 'approved').length
    const cancelled = dayRows.filter((i) => i.status === 'cancelled').length
    series.push({
      date: day,
      assigned: dayRows.length,
      done,
      overdue: dayRows.filter((i) => i.status === 'overdue').length,
      open: dayRows.filter((i) => OPEN_STATUSES.includes(i.status)).length,
      pct: pct(done, dayRows.length - cancelled),
    })
  }

  const teamDone = teamRows.filter((i) => i.status === 'approved').length
  const teamCancelled = teamRows.filter((i) => i.status === 'cancelled').length

  return {
    range: { from, to, timezone: myTz, today },
    scope: {
      canSeeTeam: teamRows.length > 0 || mine.some((p) => idx.positions.some((t) => canManagePosition(p, t, idx))),
      nodes: [...new Set(rows.map((i) => i.assigneeNodeId))].map((nid) => {
        const n = idx.nodeById.get(nid)
        return n ? { id: n.id, name: n.name, type: n.type, depth: n.depth, isFranchise: n.isFranchise } : null
      }).filter(Boolean).sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)),
      tiers: [...new Map(rows.map((i) => {
        const l = idx.levelById.get(idx.positionById.get(i.assigneePositionId)?.levelId)
        return l ? [l.id, { id: l.id, name: l.name, rank: l.rank }] : [null, null]
      }).filter(([k]) => k)).values()].sort((a, b) => a.rank - b.rank),
    },
    me,
    team: {
      total: teamRows.length,
      done: teamDone,
      open: teamRows.filter((i) => OPEN_STATUSES.includes(i.status)).length,
      overdue: teamRows.filter((i) => i.status === 'overdue').length,
      completionPct: pct(teamDone, teamRows.length - teamCancelled),
      people: withPct([...byPerson.values()]).sort((a, b) => a.pct - b.pct || b.overdue - a.overdue),
      tiers: withPct([...byTier.values()]).sort((a, b) => a.rank - b.rank),
      nodes: withPct([...byNode.values()]).sort((a, b) => a.depth - b.depth || a.nodeName.localeCompare(b.nodeName)),
      overdueLeaderboard: withPct([...byPerson.values()]).filter((p) => p.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 10),
    },
    approvalTurnaround,
    blockedNow,
    series,
  }
}
