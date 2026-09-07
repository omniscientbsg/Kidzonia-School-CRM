// Writing the Day-End report, and reading the ones your team sent you.
//
// The summary is rolled up by the server and shown read-only: the point is that
// nobody types their own numbers. All the person adds is the notes.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sunset, CheckCircle2, Clock, AlertTriangle, Inbox, Check } from 'lucide-react'
import { Spinner, Empty, Badge, Field } from '../../components/ui'
import { fmtDateTime } from '../../api/hooks'
import { useDayEndPreview, useDayEndReceived, useTaskAct } from '../../services/tasks/api'

function Counts({ counts }) {
  const cells = [
    ['Completed', counts.completed, 'teal', CheckCircle2],
    ['Still open', counts.pending, 'yellow', Clock],
    ['Overdue', counts.overdue, 'red', AlertTriangle],
    ['Awaiting sign-off', counts.awaitingApproval, 'plum', Clock],
  ]
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
      {cells.map(([label, value, tone, Icon]) => (
        <div key={label}>
          <div className="muted" style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <Icon size={11} /> {label}
          </div>
          <b style={{ fontSize: 20, fontFamily: 'var(--font-display)' }}>{value}</b>
          {value > 0 && tone === 'red' && <Badge color="red">chase</Badge>}
        </div>
      ))}
    </div>
  )
}

function TaskList({ title, rows }) {
  if (!rows?.length) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.id} style={{ fontSize: 12.5, padding: '2px 0' }}>
          • {r.title}{r.isBlocking ? ' (mandatory)' : ''}{r.serviceDate ? ` · ${r.serviceDate}` : ''}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- compose ----
export default function DayEnd() {
  const navigate = useNavigate()
  const { data, isLoading } = useDayEndPreview()
  const act = useTaskAct()
  const [note, setNote] = useState('')

  if (isLoading) return <Spinner />
  if (!data) return <div className="card"><Empty emoji="⚠️" text="Could not load today" /></div>

  if (data.alreadySubmitted || !data.instanceId) {
    return (
      <div className="card">
        <Empty emoji="🌇" text={data.alreadySubmitted ? 'You have already filed today’s report.' : 'No day-end report is required for you.'} />
      </div>
    )
  }

  // Answers are keyed by question id. The day-end template asks exactly one
  // question, `note` — Phase 6 makes the form itself configurable, and this
  // becomes a loop over whatever the form asks.
  const submit = () => act.mutate({
    path: `/task-instances/${data.instanceId}/submit`,
    body: { completion: { answers: { note } } },
    success: 'Day-end report sent',
  }, { onSuccess: () => navigate('/tasks') })

  return (
    <div>
      <div className="page-head">
        <h1 style={{ fontSize: 19 }}><Sunset size={17} style={{ verticalAlign: -3 }} /> Day-End Report</h1>
        <div className="spacer" />
        <span className="muted">
          {data.date}{data.reportsTo ? ` · goes to ${data.reportsTo.name}` : ' · nobody above you to send it to'}
        </span>
      </div>

      <div className="card">
        <div className="card-title">
          <b>Your day</b>
          <span className="muted">Rolled up automatically — you do not type these</span>
        </div>
        <Counts counts={data.summary.counts} />
        <TaskList title="Finished" rows={data.summary.completed} />
        <TaskList title="Still open" rows={data.summary.pending} />
        <TaskList title="Overdue" rows={data.summary.overdue} />
        <TaskList title="Waiting on someone else" rows={data.summary.awaitingApproval} />
      </div>

      <div className="card">
        <Field label="Anything your manager should know? *">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus
            placeholder="Handover notes, anything that slipped, anything you need." />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => navigate(-1)}>Back</button>
          <button className="btn" disabled={!note.trim() || act.isPending} onClick={submit}>
            Send to {data.reportsTo?.name || 'file'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- inbox -----
export function DayEndReceived() {
  const { data, isLoading } = useDayEndReceived()
  const act = useTaskAct()
  const [comment, setComment] = useState({})

  if (isLoading) return <Spinner />
  if (!data) return <div className="card"><Empty emoji="⚠️" text="Could not load reports" /></div>

  return (
    <div>
      <div className="page-head">
        <h1 style={{ fontSize: 19 }}><Inbox size={17} style={{ verticalAlign: -3 }} /> Day-end reports</h1>
        <div className="spacer" />
        <span className="muted">{data.date} · {data.received} received</span>
      </div>

      {data.received > 0 && (
        <div className="card">
          <div className="card-title"><b>Across your team today</b></div>
          <Counts counts={data.totals} />
        </div>
      )}

      {data.outstanding.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--marmalade)' }}>
          <b style={{ fontSize: 13.5 }}>Still to report</b>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            {data.outstanding.map((p) => p.name).join(', ')}
          </div>
        </div>
      )}

      {data.reports.length === 0 && <div className="card"><Empty emoji="📭" text="No reports in yet today" /></div>}

      {data.reports.map((r) => (
        <div className="card" key={r.id}>
          <div className="card-title">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{r.byName}</b>
              <span className="muted">{r.byTier} · {r.nodeName}</span>
              {r.acknowledgedAt && <Badge color="teal">read</Badge>}
            </div>
            <span className="muted">{fmtDateTime(r.submittedAt)}</span>
          </div>
          <Counts counts={r.summary.counts} />
          {r.notes && (
            <p style={{ margin: '0 0 12px', fontSize: 13.5, borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>{r.notes}</p>
          )}
          <TaskList title="Overdue" rows={r.summary.overdue} />
          {!r.acknowledgedAt && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input style={{ flex: 1, minWidth: 200 }} placeholder="Reply (optional)"
                value={comment[r.id] || ''} onChange={(e) => setComment((c) => ({ ...c, [r.id]: e.target.value }))} />
              <button className="btn sm teal" onClick={() => act.mutate({
                path: `/tasks/day-end/${r.id}/acknowledge`,
                body: { comment: comment[r.id] || null },
                success: 'Marked as read',
              })}>
                <Check size={12} /> Mark read
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
