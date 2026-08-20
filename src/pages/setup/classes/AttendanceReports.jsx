import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import { ArrowLeft, Search, Download, AlertTriangle, ChevronRight } from 'lucide-react'
import { useGet, todayISO } from '../../../api/hooks'
import { Spinner, Empty, Badge } from '../../../components/ui'
import { useStore } from '../../../store/useStore'
import { exportCSV, exportPDF } from '../../../lib/export'

const barColor = (p) => (p >= 90 ? '#12907e' : p >= 75 ? '#f4772e' : '#e5484d')
const shortDate = (d) => d.slice(8, 10) + '/' + d.slice(5, 7)
const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

function DownloadMenu({ onCsv, onPdf }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}><Download size={13} /> Download ▾</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, boxShadow: 'var(--shadow)', overflow: 'hidden', minWidth: 110 }}>
          {[['CSV', onCsv], ['PDF', onPdf]].map(([label, fn]) => (
            <button key={label} onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); fn() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function TrendChart({ data }) {
  if (!data.length) return <Empty emoji="📈" text="No attendance in this range" />
  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#efece4" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10.5 }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => [`${v}%`, 'Attendance']} labelFormatter={shortDate} />
          <Line type="monotone" dataKey="pct" stroke="#f4772e" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function AttendanceReports() {
  const navigate = useNavigate()
  const { activeSessionId } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')

  const [sessionId, setSessionId] = useState(activeSessionId || '')
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState(daysAgoISO(27))
  const [to, setTo] = useState(todayISO())

  const qs = `sessionId=${sessionId}&from=${from}&to=${to}`
  const { data, isLoading, isError, error, refetch } = useGet(`/reports/attendance?${qs}`)
  const { data: drill, isLoading: ldrill } = useGet(classId ? `/reports/attendance/class/${classId}?from=${from}&to=${to}` : '/health', { enabled: !!classId })

  const nonArchived = sessions.filter((s) => !s.archived)

  const header = (
    <div className="page-head">
      <h1 style={{ fontSize: 18 }}>Class Attendance</h1>
      <div className="filters">
        <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setClassId('') }}>
          <option value="">Active session</option>
          {nonArchived.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
        </select>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {(data?.classes || []).map((c) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn sm subtle" onClick={() => refetch()}><Search size={13} /> Search</button>
      </div>
      <div className="spacer" />
      <button className="btn sm ghost" onClick={() => navigate('/setup/classes')}><ArrowLeft size={13} /> Back</button>
    </div>
  )

  if (isLoading) return <div>{header}<Spinner /></div>
  if (isError) return <div>{header}<div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load report'} /></div></div>
  if (!data?.session) return <div>{header}<div className="card"><Empty emoji="📊" text="No active session to report on" /></div></div>

  const { classes, trend, totals, totalPct } = data
  const barData = classes.map((c) => ({ name: c.className.replace('Kidzo ', ''), classId: c.classId, pct: c.presentPct }))

  // ---- exports ----
  const sumCols = [{ key: 'className', label: 'Class' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'late', label: 'Late' }, { key: 'leave', label: 'Leave' }, { key: 'records', label: 'Records' }, { key: 'pct', label: 'Attendance %' }]
  const sumRows = [
    ...classes.map((c) => ({ className: c.className, present: c.counts.present, absent: c.counts.absent, late: c.counts.late, leave: c.counts.leave, records: c.records, pct: c.presentPct })),
    { className: 'TOTAL', present: totals.present, absent: totals.absent, late: totals.late, leave: totals.leave, records: classes.reduce((n, c) => n + c.records, 0), pct: totalPct },
  ]
  const drillCols = [{ key: 'name', label: 'Student' }, { key: 'section', label: 'Section' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'late', label: 'Late' }, { key: 'leave', label: 'Leave' }, { key: 'records', label: 'Records' }, { key: 'pct', label: 'Attendance %' }, { key: 'flag', label: 'Chronic (<75%)' }]
  const drillRows = () => (drill?.students || []).map((s) => ({ name: s.name, section: s.section, present: s.counts.present, absent: s.counts.absent, late: s.counts.late, leave: s.counts.leave, records: s.records, pct: s.presentPct, flag: s.chronic ? 'YES' : '' }))
  const rangeLabel = `${from} to ${to}`

  return (
    <div>
      {header}

      <div className="stat-grid">
        <div className="card"><div className="stat-label">Overall attendance</div><div className="stat-value" style={{ color: barColor(totalPct) }}>{totalPct}%</div><div className="stat-sub">{rangeLabel}</div></div>
        <div className="card"><div className="stat-label">Records</div><div className="stat-value">{classes.reduce((n, c) => n + c.records, 0)}</div><div className="stat-sub">{classes.length} classes</div></div>
      </div>

      {/* Class-wise % bar chart */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">
          <h3>Class-wise Attendance %</h3>
          <DownloadMenu
            onCsv={() => exportCSV(`attendance_${data.session.name}`, sumCols, sumRows)}
            onPdf={() => exportPDF(`Class Attendance — ${data.session.name} (${rangeLabel})`, sumCols, sumRows)}
          />
        </div>
        {barData.length === 0 ? <Empty emoji="📊" text="No attendance in this range" /> : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={barData} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#efece4" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} dy={8} height={40} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'rgba(244,119,46,0.07)' }} formatter={(v) => [`${v}%`, 'Attendance']} />
                <Bar dataKey="pct" radius={[6, 6, 0, 0]} onClick={(d) => setClassId(d.classId)} cursor="pointer">
                  {barData.map((d) => <Cell key={d.classId} fill={barColor(d.pct)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Summary table (click a class to drill down) */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title"><h3>Summary</h3><span className="muted" style={{ fontSize: 12 }}>Click a class to drill down</span></div>
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table>
            <thead><tr><th>Class</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>Records</th><th>Attendance %</th><th></th></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.classId} style={{ cursor: 'pointer' }} onClick={() => setClassId(c.classId)}>
                  <td><b>{c.className}</b></td>
                  <td>{c.counts.present}</td><td>{c.counts.absent}</td><td>{c.counts.late}</td><td>{c.counts.leave}</td>
                  <td className="muted">{c.records}</td>
                  <td><Badge color={c.presentPct >= 90 ? 'green' : c.presentPct >= 75 ? 'orange' : 'red'}>{c.presentPct}%</Badge></td>
                  <td><ChevronRight size={15} style={{ opacity: 0.5 }} /></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 800, background: 'var(--marmalade-soft)' }}>
                <td>TOTAL</td><td>{totals.present}</td><td>{totals.absent}</td><td>{totals.late}</td><td>{totals.leave}</td>
                <td>{classes.reduce((n, c) => n + c.records, 0)}</td><td>{totalPct}%</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Trend line */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title"><h3>Attendance trend</h3></div>
        <TrendChart data={trend} />
      </div>

      {/* Drill-down: per-student for the selected class */}
      {classId && (
        <div className="card">
          <div className="card-title">
            <h3>{drill?.class?.name || 'Class'} — per-student attendance</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <DownloadMenu
                onCsv={() => exportCSV(`attendance_${drill?.class?.name || 'class'}`, drillCols, drillRows())}
                onPdf={() => exportPDF(`${drill?.class?.name || 'Class'} attendance — ${rangeLabel}`, drillCols, drillRows())}
              />
              <button className="btn sm ghost" onClick={() => setClassId('')}>Close</button>
            </div>
          </div>
          {ldrill ? <Spinner /> : !drill || drill.students.length === 0 ? <Empty emoji="🎒" text="No attendance for this class in range" /> : (
            <>
              {drill.students.some((s) => s.chronic) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--berry-soft)', color: 'var(--berry)', padding: '8px 12px', borderRadius: 9, marginBottom: 12, fontSize: 13 }}>
                  <AlertTriangle size={16} /> {drill.students.filter((s) => s.chronic).length} chronic absentee{drill.students.filter((s) => s.chronic).length === 1 ? '' : 's'} (below 75%)
                </div>
              )}
              <div className="table-wrap" style={{ boxShadow: 'none' }}>
                <table>
                  <thead><tr><th>Student</th><th>Section</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>Records</th><th>Attendance %</th></tr></thead>
                  <tbody>
                    {drill.students.map((s) => (
                      <tr key={s.studentId} style={s.chronic ? { background: 'var(--berry-soft)' } : undefined}>
                        <td><b>{s.name}</b>{s.chronic && <AlertTriangle size={13} style={{ color: 'var(--berry)', marginLeft: 6, verticalAlign: 'middle' }} />}</td>
                        <td><Badge color="gray">{s.section || '—'}</Badge></td>
                        <td>{s.counts.present}</td><td>{s.counts.absent}</td><td>{s.counts.late}</td><td>{s.counts.leave}</td>
                        <td className="muted">{s.records}</td>
                        <td><Badge color={s.presentPct >= 90 ? 'green' : s.presentPct >= 75 ? 'orange' : 'red'}>{s.presentPct}%</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
