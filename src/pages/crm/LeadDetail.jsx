import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, PhoneCall, CheckCircle2 } from 'lucide-react'
import { useGet, useAct, fmtDate, fmtDateTime, todayISO } from '../../api/hooks'
import { Badge, Field, Spinner } from '../../components/ui'

const STAGES = ['new', 'contacted', 'visit_scheduled', 'visited', 'demo', 'negotiation']

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: lead, isLoading } = useGet(`/leads/${id}`)
  const { data: activities = [] } = useGet(`/leads/${id}/activities`)
  const { data: followUps = [] } = useGet(`/follow-ups?leadId=${id}`)
  const { data: programs = [] } = useGet('/programs')
  const act = useAct(['/leads', '/follow-ups', '/crm'])
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState('call')
  const [task, setTask] = useState({ dueDate: todayISO(), channel: 'call', note: '' })

  if (isLoading || !lead) return <Spinner />
  const progName = programs.find((p) => p.id === lead.programId)?.name || '—'
  const closed = ['converted', 'lost'].includes(lead.stage)

  return (
    <div>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/crm/leads')}><ArrowLeft size={16} /></button>
        <h1>{lead.childName}</h1>
        <Badge status={lead.stage} />
        {lead.lostReason && <span className="muted">({lead.lostReason})</span>}
        <div className="spacer" />
        {lead.convertedApplicationId ? (
          <Link className="btn teal" to={`/admissions/${lead.convertedApplicationId}`}>View application</Link>
        ) : (
          !closed && (
            <button
              className="btn teal"
              onClick={() =>
                act.mutate(
                  { path: `/leads/${id}/convert`, body: {}, success: 'Application created' },
                  { onSuccess: (data) => navigate(`/admissions/${data.application.id}`) }
                )
              }
            >
              <CheckCircle2 size={15} /> Convert to admission
            </button>
          )
        )}
      </div>

      <div className="two-col">
        <div>
          <div className="card">
            <div className="card-title"><h3>Enquiry details</h3></div>
            <table style={{ fontSize: 13.5 }}>
              <tbody>
                <tr><td className="muted">Program</td><td><b>{progName}</b></td></tr>
                <tr><td className="muted">Child DOB</td><td>{fmtDate(lead.childDob)}</td></tr>
                <tr><td className="muted">Parent</td><td>{lead.parentName}</td></tr>
                <tr><td className="muted">Phone</td><td>{lead.phone}</td></tr>
                <tr><td className="muted">Email</td><td>{lead.email || '—'}</td></tr>
                <tr><td className="muted">Source</td><td>{lead.source?.replace('_', ' ')}</td></tr>
                <tr><td className="muted">Expected start</td><td>{fmtDate(lead.expectedStart)}</td></tr>
                <tr><td className="muted">Fee bracket</td><td>{lead.feeBracket || '—'}</td></tr>
              </tbody>
            </table>
            {!closed && (
              <div style={{ marginTop: 14 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Move stage:</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {STAGES.filter((s) => s !== lead.stage).map((s) => (
                    <button key={s} className="btn sm ghost" onClick={() => act.mutate({ path: `/leads/${id}/stage`, body: { stage: s } })}>
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title"><h3>Follow-up tasks</h3></div>
            {followUps.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #f4efe6', fontSize: 13 }}>
                <PhoneCall size={13} style={{ color: 'var(--ink-faint)' }} />
                <span style={{ flex: 1 }}>{t.note} <span className="muted">via {t.channel}</span></span>
                <Badge status={t.status === 'open' && t.dueDate < todayISO() ? 'overdue' : t.status}>
                  {t.status === 'done' ? 'done' : fmtDate(t.dueDate)}
                </Badge>
                {t.status === 'open' && (
                  <button className="btn sm subtle" onClick={() => act.mutate({ method: 'put', path: `/follow-ups/${t.id}`, body: { status: 'done' } })}>
                    Done
                  </button>
                )}
              </div>
            ))}
            {!closed && (
              <form
                style={{ marginTop: 12 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  act.mutate({ path: '/follow-ups', body: { ...task, leadId: id }, success: 'Follow-up added' })
                  setTask({ ...task, note: '' })
                }}
              >
                <div className="form-row-3">
                  <Field label="Due"><input type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} /></Field>
                  <Field label="Channel">
                    <select value={task.channel} onChange={(e) => setTask({ ...task, channel: e.target.value })}>
                      <option>call</option><option>whatsapp</option><option>email</option>
                    </select>
                  </Field>
                  <Field label="Note"><input required value={task.note} onChange={(e) => setTask({ ...task, note: e.target.value })} placeholder="What to do" /></Field>
                </div>
                <button className="btn sm">Add follow-up</button>
              </form>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title"><h3>Activity timeline</h3></div>
          {!closed && (
            <form
              style={{ display: 'flex', gap: 8, marginBottom: 16 }}
              onSubmit={(e) => {
                e.preventDefault()
                if (!note) return
                act.mutate({ path: `/leads/${id}/activities`, body: { type: noteType, note } })
                setNote('')
              }}
            >
              <select value={noteType} onChange={(e) => setNoteType(e.target.value)} style={{ width: 110, border: '1.5px solid var(--line)', borderRadius: 9, padding: '0 8px' }}>
                <option>call</option><option>whatsapp</option><option>email</option><option>note</option><option>visit</option>
              </select>
              <input style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 9, padding: '8px 11px' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a call, visit or note…" />
              <button className="btn sm">Log</button>
            </form>
          )}
          <div className="timeline">
            {[...activities].reverse().map((a) => (
              <div className="timeline-item" key={a.id}>
                <b style={{ textTransform: 'capitalize' }}>{a.type.replace('_', ' ')}</b> — {a.note}
                <div className="muted">{fmtDateTime(a.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
