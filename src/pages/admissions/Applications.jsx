import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGet, fmtDate } from '../../api/hooks'
import { Badge, Spinner, Empty } from '../../components/ui'

const STATUSES = ['submitted', 'waitlisted', 'offered', 'confirmed', 'rejected', 'draft']

export default function Applications() {
  const navigate = useNavigate()
  const { data: apps = [], isLoading } = useGet('/applications')
  const { data: programs = [] } = useGet('/programs')
  const [status, setStatus] = useState('')

  if (isLoading) return <Spinner />
  const filtered = status ? apps.filter((a) => a.status === status) : apps
  const progName = (id) => programs.find((p) => p.id === id)?.name || '—'
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: apps.filter((a) => a.status === s).length }), {})

  return (
    <div>
      <div className="page-head">
        <h1>Applications</h1>
        <span className="badge yellow">{counts.waitlisted} waitlisted</span>
        <span className="badge green">{counts.confirmed} confirmed</span>
        <div className="spacer" />
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s} ({counts[s]})</option>)}
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Child</th><th>Program</th><th>Guardian</th><th>Applied</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => navigate(`/admissions/${a.id}`)}>
                <td><b>{a.childName}</b></td>
                <td>{progName(a.programId)}</td>
                <td>{a.guardiansDraft?.[0]?.name || '—'}</td>
                <td>{fmtDate(a.createdAt)}</td>
                <td><Badge status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty emoji="🎓" text="No applications yet — convert a lead to start one" />}
      </div>
    </div>
  )
}
