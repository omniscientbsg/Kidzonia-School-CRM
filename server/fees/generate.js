// Fee-cycle generation. Amounts integer paise. Produces ESTIMATED cycle drafts
// (no DB writes) — the route handles idempotency + persistence.
import { applyDiscounts } from './discounts.js'

// inclusive list of 'YYYY-MM' from start..end
export function monthsInRange(start, end) {
  const out = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1; if (m > 12) { m = 1; y += 1 }
  }
  return out
}

const ym = (d) => (d || '').slice(0, 7)
function monthOffset(sessionStart, month) {
  const [sy, sm] = ym(sessionStart).split('-').map(Number)
  const [y, m] = month.split('-').map(Number)
  return (y - sy) * 12 + (m - sm)
}

// does a line of this periodicity get charged in this month?
function chargeInMonth(cycle, offset, isAdmissionMonth) {
  switch (cycle) {
    case 'one_time': return isAdmissionMonth
    case 'annual': return offset % 12 === 0
    case 'half_yearly': return offset % 6 === 0
    case 'quarterly': return offset % 3 === 0
    case 'term': return offset % 4 === 0
    default: return true // monthly
  }
}

const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate() }
const monthName = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' }) }

// generate estimated cycle drafts for one student across a month range
export function generateStudentCycles({ student, session, range, sc, settings, headName }) {
  const { baseLines, ctx, joinedAt } = sc
  const admMonth = joinedAt ? ym(joinedAt) : ym(session.startDate)
  const admDay = joinedAt ? Number(joinedAt.slice(8, 10)) || 1 : 1
  const dueDay = Math.min(28, Math.max(1, settings?.perCycleDueDay?.monthly || 10))
  const drafts = []

  for (const month of range) {
    if (month < admMonth) continue // not admitted yet
    const isAdm = month === admMonth
    const offset = monthOffset(session.startDate, month)
    // lines chargeable this month (with pro-rata on the admission month for monthly heads)
    const monthLines = []
    for (const l of baseLines) {
      if (!chargeInMonth(l.cycle, offset, isAdm)) continue
      let base = l.amount
      let prorated = false
      if (isAdm && l.cycle === 'monthly' && admDay > 1) {
        const dim = daysInMonth(month)
        base = Math.round(l.amount * (dim - admDay + 1) / dim)
        prorated = true
      }
      monthLines.push({ feeHeadId: l.feeHeadId, cycle: l.cycle, amount: base, prorated })
    }
    if (monthLines.length === 0) continue

    // group charges ride on their head's billing cycle — only apply to heads billed this month
    const billedHeads = new Set(monthLines.map((l) => l.feeHeadId))
    const monthCtx = { ...ctx, groups: (ctx.groups || []).map((g) => ({ ...g, charges: (g.charges || []).filter((ch) => billedHeads.has(ch.feeHeadId)) })) }
    const breakdown = applyDiscounts(monthLines.map((l) => ({ feeHeadId: l.feeHeadId, amount: l.amount, cycle: l.cycle })), monthCtx)
    const proratedHeads = new Set(monthLines.filter((l) => l.prorated).map((l) => l.feeHeadId))
    const lines = breakdown.map((b) => ({
      feeHeadId: b.feeHeadId,
      description: `${headName(b.feeHeadId)}${proratedHeads.has(b.feeHeadId) ? ' (pro-rata)' : ''} – ${monthName(month)}`,
      base: b.base, concession: b.concession, corporate: b.corporate, groupDiscount: b.groupDiscount, groupCharge: b.groupCharge,
      amount: b.net,
    }))
    const gross = lines.reduce((s, l) => s + l.base, 0)
    const total = lines.reduce((s, l) => s + l.amount, 0)
    drafts.push({
      academicYearId: session.id, branchId: student.branchId, studentId: student.id, classId: sc.classId,
      cycleKey: month, cycleLabel: monthName(month), lines,
      gross, discountTotal: gross - total, total,
      dueDate: `${month}-${String(dueDay).padStart(2, '0')}`,
      status: 'estimated',
    })
  }
  return drafts
}
