import { useState } from 'react'
import { Plus, Eye, CheckCircle, Send } from 'lucide-react'
import { useGet, useAct, fmtDateTime } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'

function ComposeModal({ onClose }) {
  const act = useAct(['/announcements'])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audienceType, setAudienceType] = useState('all')
  const [requiresAck, setRequiresAck] = useState(false)

  return (
    <Modal title="New announcement" onClose={onClose}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Day Practice Schedule" autoFocus /></Field>
      <Field label="Body"><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the announcement…" /></Field>
      <div className="form-row">
        <Field label="Audience">
          <select value={audienceType} onChange={(e) => setAudienceType(e.target.value)}>
            <option value="all">All parents (branch)</option>
            <option value="branch">Branch-level</option>
          </select>
        </Field>
        <Field label="Options">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13.5, marginTop: 8 }}>
            <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} style={{ accentColor: 'var(--marmalade)', width: 16, height: 16 }} />
            Require acknowledgement
          </label>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!title.trim() || !body.trim()} onClick={() => act.mutate(
          { path: '/announcements', body: { title: title.trim(), body: body.trim(), audience: { type: audienceType, ids: [] }, requiresAck }, success: 'Announcement published' },
          { onSuccess: onClose }
        )}><Send size={14} /> Publish</button>
      </div>
    </Modal>
  )
}

function StatsModal({ announcementId, onClose }) {
  const { data: stats, isLoading } = useGet(`/announcements/${announcementId}/stats`)
  return (
    <Modal title="Read / Acknowledgement stats" onClose={onClose}>
      {isLoading ? <Spinner /> : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <Badge color="blue">{stats.recipients} recipients</Badge>
            <Badge color="green">{stats.read} read</Badge>
            <Badge color="orange">{stats.acknowledged} acknowledged</Badge>
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Name</th><th>Read</th><th>Acknowledged</th></tr></thead>
              <tbody>
                {stats.readers.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.userName}</b></td>
                    <td>{r.readAt ? <Badge color="green">✓ {fmtDateTime(r.readAt)}</Badge> : <span className="muted">—</span>}</td>
                    <td>{r.ackAt ? <Badge color="green">✓ {fmtDateTime(r.ackAt)}</Badge> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function Announcements() {
  const { data: announcements = [], isLoading } = useGet('/announcements')
  const [creating, setCreating] = useState(false)
  const [statsFor, setStatsFor] = useState(null)
  const act = useAct(['/announcements'])

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head">
        <h1>Announcements</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> New announcement</button>
      </div>

      {announcements.length === 0 && <Empty emoji="📢" text="No announcements yet" />}
      {announcements.map((ann) => (
        <div className="card" key={ann.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>{ann.title}</h3>
              <div className="muted">{fmtDateTime(ann.publishedAt)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {ann.requiresAck && <Badge color="orange">Ack required</Badge>}
              <Badge color="gray">{ann.audience?.type || 'all'}</Badge>
            </div>
          </div>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{ann.body}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn sm subtle" onClick={() => setStatsFor(ann.id)}>
              <Eye size={13} /> Read stats
            </button>
            <button className="btn sm ghost" onClick={() => act.mutate({ method: 'del', path: `/announcements/${ann.id}`, success: 'Deleted' })}>Delete</button>
          </div>
        </div>
      ))}

      {creating && <ComposeModal onClose={() => setCreating(false)} />}
      {statsFor && <StatsModal announcementId={statsFor} onClose={() => setStatsFor(null)} />}
    </div>
  )
}
