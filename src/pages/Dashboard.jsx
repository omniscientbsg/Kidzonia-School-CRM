import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useGet, fmtMoney, fmtDate } from '../api/hooks'
import { StatCard, Badge, Spinner } from '../components/ui'

const STAGE_LABELS = { new: 'New', contacted: 'Contacted', visit_scheduled: 'Visit booked', visited: 'Visited', demo: 'Demo', negotiation: 'Negotiation', converted: 'Converted', lost: 'Lost' }

function BranchCards({ b }) {
  return (
    <div className="stat-grid">
      <StatCard label="Active students" value={b.activeStudents} tone="orange" />
      <StatCard
        label="Attendance today"
        value={b.attendanceToday.marked ? `${b.attendanceToday.present}/${b.attendanceToday.marked}` : '—'}
        sub={b.attendanceToday.absent ? `${b.attendanceToday.absent} absent` : 'No absences recorded'}
        tone="green"
      />
      <StatCard label="Fees due" value={fmtMoney(b.fees.due)} sub={`${b.fees.overdueInvoices} overdue invoices`} tone="red" />
      <StatCard label="Collected this month" value={fmtMoney(b.fees.collectedThisMonth)} sub={`${fmtMoney(b.fees.collectedToday)} today`} tone="yellow" />
      <StatCard label="Open enquiries" value={b.crm.openLeads} sub={`${b.pendingLeaves} pending leave requests`} tone="blue" />
    </div>
  )
}

function Funnel({ byStage }) {
  const data = Object.entries(STAGE_LABELS).map(([k, label]) => ({ label, count: byStage[k] || 0 }))
  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fontFamily: 'Nunito Sans' }} interval={0} angle={-18} dy={8} height={44} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(244,119,46,0.07)' }} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.label === 'Converted' ? '#12907e' : d.label === 'Lost' ? '#e5484d' : '#f4772e'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Occupancy({ occupancy }) {
  return (
    <div>
      {occupancy.map((o) => (
        <div key={o.classId} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
            <span>{o.className}</span>
            <span className="muted">{o.enrolled}/{o.capacity}</span>
          </div>
          <div style={{ height: 8, background: '#f0ebe0', borderRadius: 4 }}>
            <div style={{ height: '100%', width: `${o.capacity ? Math.min(100, (o.enrolled / o.capacity) * 100) : 0}%`, background: o.enrolled / (o.capacity || 1) > 0.9 ? 'var(--berry)' : 'var(--teal)', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { data, isLoading } = useGet('/dashboards/summary')
  if (isLoading || !data) return <Spinner />

  if (data.role === 'super_admin') {
    return (
      <div>
        <div className="page-head"><h1>HQ Overview</h1></div>
        {data.branches.map((b) => (
          <div className="card" key={b.branchId}>
            <div className="card-title"><h2>{b.branchName}</h2></div>
            <BranchCards b={b} />
            <div className="two-col">
              <div><h3 style={{ marginBottom: 10 }}>Enquiry funnel</h3><Funnel byStage={b.crm.byStage} /></div>
              <div><h3 style={{ marginBottom: 10 }}>Class occupancy</h3><Occupancy occupancy={b.occupancy} /></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (data.role === 'teacher') {
    return (
      <div>
        <div className="page-head"><h1>My classes today</h1></div>
        <div className="stat-grid">
          {data.sections.map((s) => (
            <StatCard key={s.sectionId} label={s.name} value={`${s.students} kids`} sub={s.attendanceMarked ? `${s.attendanceMarked} marked today` : 'Attendance not marked yet'} tone={s.attendanceMarked ? 'green' : 'red'} />
          ))}
        </div>
        <div className="card">
          <div className="card-title"><h3>Quick actions</h3></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn" to="/attendance">Mark attendance</Link>
            <Link className="btn subtle" to="/daily/feed">Post to diary</Link>
            <Link className="btn subtle" to="/daily/logs">Log meals / nap</Link>
            <Link className="btn subtle" to="/daily/checkin">Check-in / out</Link>
          </div>
        </div>
      </div>
    )
  }

  if (data.role === 'front_desk') {
    return (
      <div>
        <div className="page-head">
          <h1>Counsellor desk</h1>
          <div className="spacer" />
          <Link className="btn" to="/crm/leads">+ New enquiry</Link>
        </div>
        <div className="stat-grid">
          <StatCard label="Open enquiries" value={data.crm.openLeads} tone="orange" />
          <StatCard label="My open tasks" value={data.myTasks.length} sub={`${data.overdueTasks} overdue`} tone={data.overdueTasks ? 'red' : 'green'} />
          <StatCard label="Active students" value={data.activeStudents} tone="blue" />
        </div>
        <div className="two-col">
          <div className="card">
            <div className="card-title"><h3>Enquiry funnel</h3></div>
            <Funnel byStage={data.crm.byStage} />
          </div>
          <div className="card">
            <div className="card-title"><h3>My follow-ups</h3></div>
            {data.myTasks.length === 0 && <div className="muted">No open follow-ups 🎉</div>}
            {data.myTasks.slice(0, 8).map((tk) => (
              <div key={tk.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f4efe6', fontSize: 13 }}>
                <span><b>{tk.leadName}</b> — {tk.note}</span>
                <Badge status={tk.overdue ? 'overdue' : 'open'}>{fmtDate(tk.dueDate)}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // branch_admin + accountant
  return (
    <div>
      <div className="page-head"><h1>{data.branchName}</h1></div>
      <BranchCards b={data} />
      <div className="two-col">
        <div className="card">
          <div className="card-title"><h3>Enquiry funnel</h3></div>
          <Funnel byStage={data.crm.byStage} />
        </div>
        <div className="card">
          <div className="card-title"><h3>Class occupancy</h3></div>
          <Occupancy occupancy={data.occupancy} />
        </div>
      </div>
    </div>
  )
}
