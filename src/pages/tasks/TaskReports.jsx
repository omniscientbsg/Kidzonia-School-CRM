import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, Legend,
} from 'recharts'
import { Download, Flame, Lock, Clock, TrendingUp } from 'lucide-react'
import { Spinner, Empty, StatCard, Badge } from '../../components/ui'
import { fmtDateTime } from '../../api/hooks'
import { exportCSV, exportXLSX, exportPDF } from '../../lib/export'
import { useAnalytics } from '../../services/tasks/api'
import { STATUS_LABEL } from '../../services/tasks/status'

const shift = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'This year']]
// 'rejected' is not a stored status — a rejection hands the work straight back
// as in_progress and the pill is derived — so filtering on it matched nothing.
const STATUS_FILTERS = ['assigned', 'in_progress', 'submitted', 'approved', 'overdue', 'deferred', 'cancelled', 'expired']

// One export control reused by every table on the page.
function Exports({ name, columns, rows }) {
  if (!rows.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <Download size={13} style={{ color: 'var(--ink-faint)' }} />
      <button className="btn sm ghost" onClick={() => exportCSV(name, columns, rows)}>CSV</button>
      <button className="btn sm ghost" onClick={() => exportXLSX(name, columns, rows)}>Excel</button>
      <button className="btn sm ghost" onClick={() => exportPDF(name, columns, rows)}>PDF</button>
    </div>
  )
}

function Bar100({ pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#efece4', borderRadius: 3, minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct >= 80 ? 'var(--teal)' : pct >= 50 ? 'var(--marmalade)' : 'var(--berry)' }} />
      </div>
      <b style={{ fontSize: 12 }}>{pct}%</b>
    </div>
  )
}

function RollupTable({ title, subtitle, rows, labelKey, labelHead, extraCols = [], exportName }) {
  const columns = [
    { key: labelKey, label: labelHead },
    ...extraCols,
    { key: 'total', label: 'Assigned' },
    { key: 'done', label: 'Done' },
    { key: 'open', label: 'Open' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'pct', label: 'Completion %' },
  ]
  return (
    <div className="card">
      <div className="card-title">
        <div><b>{title}</b> {subtitle && <span className="muted">{subtitle}</span>}</div>
        <Exports name={exportName} columns={columns} rows={rows} />
      </div>
      {!rows.length ? <Empty emoji="📊" text="Nothing in this range" /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{labelHead}</th>
                {extraCols.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>Assigned</th><th>Done</th><th>Open</th><th>Overdue</th><th>Closed</th><th>Completion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r[labelKey] + i}>
                  <td><b>{r[labelKey]}</b></td>
                  {extraCols.map((c) => <td key={c.key} className="muted">{r[c.key]}</td>)}
                  <td>{r.total}</td>
                  <td>{r.done}</td>
                  <td>{r.open || '—'}</td>
                  <td>{r.overdue ? <Badge color="red">{r.overdue}</Badge> : '—'}</td>
                  {/* closed without being done — out of the completion denominator,
                      so it needs a column of its own or it vanishes entirely */}
                  <td>{r.expired ? <Badge color="plum">{r.expired}</Badge> : '—'}</td>
                  <td style={{ minWidth: 130 }}><Bar100 pct={r.pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function TaskReports() {
  const [range, setRange] = useState('30')
  const [nodeId, setNodeId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [status, setStatus] = useState('')
  const [recurring, setRecurring] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  const { data, isLoading, isError, error } = useAnalytics({
    from: shift(Number(range)), to: today, nodeId, levelId, status, recurring,
  })

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load the dashboard'} /></div>

  const { me, team, scope, approvalTurnaround: turn, blockedNow = [], series = [] } = data
  const hasTeam = team.total > 0 || scope.canSeeTeam

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">All schools / nodes you can see</option>
            {scope.nodes.map((n) => <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.name}{n.isFranchise ? ' (franchise)' : ''}</option>)}
          </select>
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">All role-tiers</option>
            {scope.tiers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select value={recurring} onChange={(e) => setRecurring(e.target.value)}>
            <option value="">Recurring + one-off</option>
            <option value="true">Recurring only</option>
            <option value="false">One-off only</option>
          </select>
        </div>
      </div>

      {/* ---------------- assignee view: always shown ---------------- */}
      <div className="nav-label" style={{ color: 'var(--ink-soft)', padding: '0 0 8px' }}>Your own work</div>
      <div className="stat-grid">
        <StatCard label="Your completion" value={`${me.completionPct}%`} sub={`${me.done} of ${me.total - (me.total - me.done - me.open - me.awaitingApproval)} closed`} tone={me.completionPct >= 80 ? 'green' : 'orange'} />
        <StatCard label="Overdue" value={me.overdue} tone={me.overdue ? 'red' : 'green'} />
        <StatCard label="Current streak" value={`${me.streak.current} ${me.streak.current === 1 ? 'day' : 'days'}`} sub={`best ${me.streak.longest} · ${me.streak.daysTracked} days tracked`} tone="orange" />
        <StatCard label="Awaiting approval" value={me.awaitingApproval} tone="yellow" />
      </div>
      {me.streak.current >= 3 && (
        <div className="card" style={{ background: 'var(--marmalade-soft)', marginBottom: 18 }}>
          <span style={{ fontSize: 13.5, color: 'var(--marmalade-deep)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Flame size={16} /> <b>{me.streak.current}-day streak</b> — every task closed on the day it was due.
          </span>
        </div>
      )}
      {me.blockingOpen > 0 && (
        <div className="card" style={{ background: 'var(--berry-soft)', marginBottom: 18 }}>
          <span style={{ fontSize: 13.5, color: 'var(--berry)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={16} /> {me.blockingOpen} mandatory task{me.blockingOpen > 1 ? 's' : ''} still open — your logout is blocked.
          </span>
        </div>
      )}

      {series.length > 1 && (
        <div className="card">
          <div className="card-title">
            <div><b>Completion over time</b> <span className="muted">{data.range.from} → {data.range.to} · {data.range.timezone}</span></div>
            <Exports
              name="task-completion-over-time"
              columns={[{ key: 'date', label: 'Date' }, { key: 'assigned', label: 'Assigned' }, { key: 'done', label: 'Done' }, { key: 'open', label: 'Open' }, { key: 'overdue', label: 'Overdue' }, { key: 'pct', label: 'Completion %' }]}
              rows={series}
            />
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="done" name="Done" stackId="a" fill="#12907e" />
                <Bar yAxisId="left" dataKey="open" name="Open" stackId="a" fill="#f4772e" />
                <Bar yAxisId="left" dataKey="overdue" name="Overdue" stackId="a" fill="#e5484d" radius={[5, 5, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="pct" name="Completion %" stroke="#5b4a99" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ---------------- manager / HQ view ---------------- */}
      {!hasTeam ? (
        <div className="card">
          <Empty emoji="🌱" text="You have nobody below you, so there is no team roll-up to show." />
        </div>
      ) : (
        <>
          <div className="nav-label" style={{ color: 'var(--ink-soft)', padding: '18px 0 8px' }}>
            Your downline {nodeId ? '· filtered to one node' : `· ${scope.nodes.length} node${scope.nodes.length === 1 ? '' : 's'}`}
          </div>
          <div className="stat-grid">
            <StatCard label="Team completion" value={`${team.completionPct}%`} sub={`${team.done} of ${team.total}`} tone={team.completionPct >= 80 ? 'green' : 'orange'} />
            <StatCard label="Open" value={team.open} tone="yellow" />
            <StatCard label="Overdue" value={team.overdue} tone={team.overdue ? 'red' : 'green'} />
            <StatCard label="Blocked right now" value={blockedNow.filter((b) => !b.isSelf).length} tone={blockedNow.length ? 'red' : 'green'} />
          </div>

          {blockedNow.length > 0 && (
            <div className="card">
              <div className="card-title">
                <div><b>Who is blocked right now</b> <span className="muted">open mandatory work due today or earlier</span></div>
                <Exports
                  name="blocked-now"
                  columns={[{ key: 'userName', label: 'Person' }, { key: 'tier', label: 'Tier' }, { key: 'nodeName', label: 'School' }, { key: 'count', label: 'Tasks' }, { key: 'oldestDate', label: 'Oldest' }, { key: 'daysStuck', label: 'Days' }, { key: 'state', label: 'State' }]}
                  rows={blockedNow.map((b) => ({ ...b, state: b.armed ? 'writes frozen' : 'logout blocked' }))}
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Person</th><th>Tier</th><th>School</th><th>Tasks</th><th>Oldest</th><th>State</th></tr></thead>
                  <tbody>
                    {blockedNow.map((b) => (
                      <tr key={b.userId}>
                        <td><b>{b.userName}</b>{b.isSelf && <Badge color="plum">you</Badge>}<div className="muted">{b.titles.join(' · ')}</div></td>
                        <td>{b.tier}</td>
                        <td>{b.nodeName}</td>
                        <td>{b.count}</td>
                        <td className="muted">{b.oldestDate}{b.daysStuck > 0 ? ` (${b.daysStuck}d)` : ''}</td>
                        <td>
                          {b.armed
                            ? <Badge color="red">writes frozen</Badge>
                            : <Badge color="yellow">logout blocked</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title"><b>Approval turnaround</b><span className="muted">submitted → decided</span></div>
            <div className="stat-grid" style={{ marginBottom: turn.byApprover.length ? 14 : 0 }}>
              <StatCard label="Average" value={turn.avgHours != null ? `${turn.avgHours} h` : '—'} tone="blue" sub={`${turn.decisions} decisions`} />
              <StatCard label="Median" value={turn.medianHours != null ? `${turn.medianHours} h` : '—'} />
              <StatCard label="90th percentile" value={turn.p90Hours != null ? `${turn.p90Hours} h` : '—'} tone="yellow" />
              <StatCard
                label="Waiting now"
                value={turn.pendingNow}
                tone={turn.pendingNow ? 'orange' : 'green'}
                sub={turn.oldestPendingHours != null ? `oldest ${turn.oldestPendingHours} h` : ''}
              />
            </div>
            {turn.byApprover.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Approver</th><th>Decisions</th><th>Approved</th><th>Sent back</th><th>Overrides</th><th>Avg turnaround</th></tr></thead>
                  <tbody>
                    {turn.byApprover.map((a) => (
                      <tr key={a.userId}>
                        <td><b>{a.userName}</b></td>
                        <td>{a.decisions}</td>
                        <td>{a.approved}</td>
                        <td>{a.rejected || '—'}</td>
                        <td>{a.overrides ? <Badge color="plum">{a.overrides}</Badge> : '—'}</td>
                        <td><Clock size={12} style={{ verticalAlign: -1, color: 'var(--ink-faint)' }} /> {a.avgHours} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {team.overdueLeaderboard.length > 0 && (
            <RollupTable
              title="Overdue leaderboard"
              subtitle="most overdue first"
              rows={team.overdueLeaderboard}
              labelKey="userName" labelHead="Person"
              extraCols={[{ key: 'tier', label: 'Tier' }, { key: 'nodeName', label: 'School' }]}
              exportName="task-overdue-leaderboard"
            />
          )}

          <RollupTable
            title="By school / node" rows={team.nodes}
            labelKey="nodeName" labelHead="Node"
            extraCols={[{ key: 'nodeType', label: 'Type' }, { key: 'depth', label: 'Level' }]}
            exportName="task-completion-by-node"
          />

          <RollupTable
            title="By role-tier" rows={team.tiers}
            labelKey="tier" labelHead="Tier"
            exportName="task-completion-by-tier"
          />

          <RollupTable
            title="By person" subtitle="lowest completion first" rows={team.people}
            labelKey="userName" labelHead="Person"
            extraCols={[{ key: 'tier', label: 'Tier' }, { key: 'nodeName', label: 'School' }]}
            exportName="task-completion-by-person"
          />

          <div className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 30 }}>
            <TrendingUp size={13} />
            Roll-ups cover only people below you in the org tree. Generated {fmtDateTime(new Date().toISOString())}.
          </div>
        </>
      )}
    </div>
  )
}
