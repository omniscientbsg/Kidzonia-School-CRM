import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGet } from '../../api/hooks'
import { Badge, Spinner, Empty } from '../../components/ui'
import { initials } from '../../api/hooks'

export default function Students() {
  const navigate = useNavigate()
  const { data: students = [], isLoading } = useGet('/students')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')

  if (isLoading) return <Spinner />
  const filtered = students.filter((s) => {
    const name = `${s.firstName} ${s.lastName}`.toLowerCase()
    return (!status || s.status === status) && (!q || name.includes(q.toLowerCase()))
  })

  return (
    <div>
      <div className="page-head">
        <h1>Students</h1>
        <span className="badge green">{students.filter((s) => s.status === 'active').length} active</span>
        <div className="spacer" />
        <div className="filters">
          <input placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="alumni">Alumni</option>
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Student</th><th>Class</th><th>Roll</th><th>DOB</th><th>Blood</th><th>Allergies</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="avatar">{initials(`${s.firstName} ${s.lastName}`)}</span>
                    <b>{s.firstName} {s.lastName}</b>
                  </div>
                </td>
                <td>{s.className ? `${s.className} — ${s.sectionName}` : '—'}</td>
                <td>{s.rollNo || '—'}</td>
                <td>{s.dob}</td>
                <td>{s.bloodGroup || '—'}</td>
                <td>{s.allergies ? <Badge color="red">{s.allergies}</Badge> : <span className="muted">None</span>}</td>
                <td><Badge status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty emoji="🧒" text="No students match" />}
      </div>
    </div>
  )
}
