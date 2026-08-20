import { useGet, useAct, fmtDateTime } from '../../api/hooks'
import { Spinner, Empty, Badge } from '../../components/ui'

export default function ParentNotices() {
  const { data: announcements = [], isLoading } = useGet('/parent/announcements')
  const act = useAct(['/parent/announcements'])

  if (isLoading) return <Spinner />

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>Notices</h2>
      {announcements.length === 0 && <Empty emoji="📢" text="No notices" />}
      {announcements.map((ann) => (
        <div
          key={ann.id}
          className="card"
          style={{ marginBottom: 10, borderLeft: ann.readAt ? 'none' : '3px solid var(--marmalade)' }}
          onClick={() => !ann.readAt && act.mutate({ path: `/announcements/${ann.id}/read` })}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>{ann.title}</b>
            {!ann.readAt && <Badge color="orange">New</Badge>}
          </div>
          <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{ann.body}</p>
          <div className="muted" style={{ marginTop: 6 }}>{fmtDateTime(ann.publishedAt)}</div>
          {ann.requiresAck && !ann.ackAt && (
            <button
              className="btn sm" style={{ marginTop: 8 }}
              onClick={(e) => { e.stopPropagation(); act.mutate({ path: `/announcements/${ann.id}/ack`, success: 'Acknowledged' }) }}
            >
              Acknowledge ✓
            </button>
          )}
          {ann.ackAt && <Badge color="green" style={{ marginTop: 6 }}>Acknowledged</Badge>}
        </div>
      ))}
    </div>
  )
}
