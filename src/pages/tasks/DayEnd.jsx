// Writing the Day-End report, and reading the ones your team sent you.
//
// The summary is rolled up by the server and shown read-only: the point is that
// nobody types their own numbers. What the person adds is the answers to their
// own school's form — one hardcoded "anything to flag?" box until day-end forms
// existed, and the same question for a teacher and a bus driver.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sunset, CheckCircle2, Clock, AlertTriangle, Inbox, Check } from 'lucide-react'
import { Spinner, Empty, Badge } from '../../components/ui'
import { fmtDateTime } from '../../api/hooks'
import { useDayEndPreview, useDayEndReceived, useTaskAct } from '../../services/tasks/api'
import QuestionFields, { unanswered } from './QuestionFields'

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
  // seeded from whatever was already saved against tonight's occurrence, so a
  // half-written report survives a refresh
  const [answers, setAnswers] = useState(null)

  if (isLoading) return <Spinner />
  if (!data) return <div className="card"><Empty emoji="⚠️" text="Could not load today" /></div>

  if (data.alreadySubmitted || !data.instanceId) {
    return (
      <div className="card">
        <Empty emoji="🌇" text={data.alreadySubmitted ? 'You have already filed today’s report.' : 'No day-end report is required for you.'} />
      </div>
    )
  }

  // Whatever this person's own form asks, keyed by question id. The questions
  // come off the SNAPSHOT on tonight's occurrence, not off the form as it
  // stands now — an edit made this afternoon must not change what they are
  // halfway through answering.
  const questions = data.questions || []
  const filled = answers ?? (data.answers || {})
  const stillNeeded = unanswered(questions, filled)

  const submit = () => act.mutate({
    path: `/task-instances/${data.instanceId}/submit`,
    body: { completion: { answers: filled } },
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
        {data.statement && <p style={{ margin: '0 0 12px', fontSize: 13.5 }}>{data.statement}</p>}
        <QuestionFields
          questions={questions}
          answers={filled}
          onChange={setAnswers}
          disabled={act.isPending}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => navigate(-1)}>Back</button>
          <button className="btn" disabled={stillNeeded.length > 0 || act.isPending} onClick={submit}>
            Send to {data.reportsTo?.name || 'file'}
          </button>
        </div>
      </div>
    </div>
  )
}

// What they actually wrote, read back against the questions they were asked.
//
// The report carries its OWN copy of the questions, so one filed in March is
// still legible after the form has been rewritten or deleted. Reports written
// before day-end forms existed carry only `notes`, which is the fallback.
function Answers({ report }) {
  const questions = report.questions || []
  const answers = report.answers || {}
  if (!questions.length) {
    return report.notes
      ? <p style={{ margin: '0 0 12px', fontSize: 13.5, borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>{report.notes}</p>
      : null
  }
  return (
    <div style={{ margin: '0 0 12px', borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
      {questions.map((q) => {
        const v = answers[q.id]
        const said = q.type === 'checklist'
          ? (q.items || []).filter((c) => (v || []).includes(c.id)).map((c) => c.text).join(', ')
          : (q.type === 'yes_no' || q.type === 'choose_one')
            ? ((q.options || []).find((o) => o.value === v)?.label || v)
            : v
        if (said === undefined || said === null || said === '') return null
        return (
          <div key={q.id} style={{ marginBottom: 6 }}>
            <div className="muted" style={{ fontSize: 11.5 }}>{q.prompt}</div>
            <div style={{ fontSize: 13.5 }}>{String(said)}</div>
          </div>
        )
      })}
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
          <Answers report={r} />
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
