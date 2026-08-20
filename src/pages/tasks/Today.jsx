// Where a login lands.
//
// Two questions, answered before anything else: what do I have to do today, and
// what is standing between me and going home. Everything is ordered worst-first
// by the server, so this file does no sorting of its own.
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock, Inbox, Lock } from 'lucide-react'
import { Spinner, Empty, Badge, Callout } from '../../components/ui'
import { useToday } from '../../services/tasks/api'
import { dueLabel, statusColor, statusLabel } from '../../services/tasks/status'
import Countdown from './Countdown'

function Row({ inst, onOpen }) {
  return (
    <button type="button" className="att-row" onClick={onOpen}
      style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--line)', cursor: 'pointer', padding: '10px 2px' }}>
      <div style={{ flex: 1 }}>
        {/* at most two badges: is it mandatory, and is it urgent. Everything
            else that used to be a pill is now a word on the line below. */}
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>{inst.title}</b>
          {inst.isBlocking && <Badge color="orange"><Lock size={9} style={{ verticalAlign: -1 }} /> mandatory</Badge>}
          {inst.priority === 'urgent' && <Badge color="red">urgent</Badge>}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          {inst.assignedByName ? `From ${inst.assignedByName} · ` : ''}{dueLabel(inst)}
          {inst.requiresApproval ? ' · needs sign-off' : ''}
        </div>
      </div>
      <Badge color={statusColor(inst)}>{statusLabel(inst)}</Badge>
      <Countdown inst={inst} />
    </button>
  )
}

function Group({ icon: Icon, title, tone, rows, onOpen, empty }) {
  if (!rows.length) return empty ? <div className="card"><Empty emoji="🎉" text={empty} /></div> : null
  return (
    <div className="card">
      <div className="card-title">
        <b><Icon size={14} style={{ verticalAlign: -2, color: tone }} /> {title}</b>
        <span className="muted">{rows.length}</span>
      </div>
      {rows.map((i) => <Row key={i.id} inst={i} onOpen={() => onOpen(i.id)} />)}
    </div>
  )
}

export default function Today() {
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useToday()

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load today'} /></div>

  const open = (id) => navigate(`/tasks/instances/${id}`)
  const { signOff } = data
  const nothing = !data.overdue.length && !data.dueToday.length

  return (
    <div>
      <div className="page-head">
        <h1 style={{ fontSize: 19 }}>Today</h1>
        <div className="spacer" />
        <span className="muted">{data.today} · {data.doneToday} done today</span>
      </div>

      {/* THE one accent block on this page: the only thing here that needs a
          decision. Everything else is a list. */}
      {signOff.count > 0 && (
        <Callout tone={signOff.released ? 'good' : 'warn'} icon={<AlertTriangle size={16} />}
          title={signOff.released
            ? 'You have been released for today'
            : `${signOff.count} ${signOff.count === 1 ? 'thing' : 'things'} to finish before you sign off`}>
          {signOff.released
            ? `${signOff.release?.by} released you${signOff.release?.reason ? ` — ${signOff.release.reason}` : ''}.`
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                {signOff.items.map((i) => (
                  <button type="button" key={i.id} className="badge gray" style={{ cursor: 'pointer', border: 'none' }}
                    onClick={() => open(i.id)}>
                    {i.title}
                  </button>
                ))}
              </div>
            )}
        </Callout>
      )}

      <Group icon={AlertTriangle} tone="var(--berry)" title="Left over from before" rows={data.overdue} onOpen={open} />
      <Group icon={Clock} tone="var(--marmalade-deep)" title="On your plate today" rows={data.dueToday} onOpen={open}
        empty={nothing ? 'Nothing due today. Enjoy it.' : null} />
      <Group icon={CheckCircle2} tone="var(--teal)" title="Waiting on someone else" rows={data.waiting} onOpen={open} />
      <Group icon={Clock} tone="var(--ink-faint)" title="Coming up" rows={data.later.slice(0, 5)} onOpen={open} />

      {data.reportsWaiting > 0 && (
        <button type="button" className="card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none' }}
          onClick={() => navigate('/tasks/day-end/received')}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Inbox size={15} style={{ color: 'var(--teal)' }} />
            <b style={{ fontSize: 13.5 }}>{data.reportsWaiting} day-end report{data.reportsWaiting === 1 ? '' : 's'} from your team</b>
            <div className="spacer" />
            <span className="muted">Read them →</span>
          </div>
        </button>
      )}
    </div>
  )
}
