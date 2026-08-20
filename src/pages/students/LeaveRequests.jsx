import { useState } from 'react'
import { useGet, useAct, fmtDate } from '../../api/hooks'
import { Badge, Spinner, Empty } from '../../components/ui'

export default function LeaveRequests() {
  const { data: rows = [], isLoading } = useGet('/leave-requests')
  const act = useAct(['/leave-requests', '/attendance'])
  const [filter, setFilter] = useState('pending')

  if (isLoading) return <Spinner />
  const filtered = filter ? rows.filter((r) => r.status === filter) : rows

  return (
    <div>
      <div className="page-head">
        <h1>Leave requests</h1>
        <span className="badge yellow">{rows.filter((r) => r.status === 'pending').length} pending</span>
        <div className="spacer" />
        <div className="filters">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Student</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><b>{r.studentName}</b></td>
                <td>{fmtDate(r.fromDate)}</td>
                <td>{fmtDate(r.toDate)}</td>
                <td>{r.reason}</td>
                <td><Badge status={r.status} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'pending' && (
                    <>
                      <button className="btn sm teal" onClick={() => act.mutate({ path: `/leave-requests/${r.id}/decide`, body: { status: 'approved' }, success: 'Leave approved — attendance updated' })}>Approve</button>{' '}
                      <button className="btn sm ghost" onClick={() => act.mutate({ path: `/leave-requests/${r.id}/decide`, body: { status: 'rejected' }, success: 'Leave rejected' })}>Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty emoji="🌴" text="No leave requests" />}
      </div>
    </div>
  )
}
