import { useState } from 'react'
import { Play, Send, Lock, LayoutList, Columns3 } from 'lucide-react'
import { Spinner, Empty, StatCard } from '../../components/ui'
import { useMyTasks, useTaskAct } from '../../services/tasks/api'
import TaskCard from './TaskCard'

// Due today / This week / Upcoming / Overdue, plus the two states that are not
// waiting on the assignee at all (submitted, deferred).
// Plain headings. Emoji in a section header reads as decoration, and made six
// groups look like six unrelated widgets.
const GROUPS = [
  { key: 'overdue', title: 'Late' },
  { key: 'dueToday', title: 'Today' },
  { key: 'thisWeek', title: 'Later this week' },
  { key: 'upcoming', title: 'After that' },
  { key: 'waiting', title: 'Waiting on someone else' },
  { key: 'deferred', title: 'Pushed to another day' },
]

function Actions({ inst, act }) {
  return (
    <>
      {inst.can?.start && (
        <button className="btn sm subtle" onClick={() => act.mutate({ path: `/task-instances/${inst.id}/start`, success: 'Started' })}>
          <Play size={12} /> Start
        </button>
      )}
      {inst.can?.submit && !inst.requiresMedia && (
        <button className="btn sm" onClick={() => act.mutate({ path: `/task-instances/${inst.id}/submit`, success: inst.requiresApproval ? 'Sent for approval' : 'Completed' })}>
          <Send size={12} /> {inst.requiresApproval ? 'Submit' : 'Mark done'}
        </button>
      )}
    </>
  )
}

export default function MyTasks() {
  const { data, isLoading, isError, error } = useMyTasks({ poll: 60000 })
  const act = useTaskAct()
  const [view, setView] = useState('list')

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load your tasks'} /></div>

  const { today, timezone, doneToday = 0, blockingOpen = 0 } = data || {}
  const groups = GROUPS.map((g) => ({ ...g, rows: data?.[g.key] || [] }))
  const nothing = groups.every((g) => !g.rows.length)

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="Overdue" value={data.overdue.length} tone={data.overdue.length ? 'red' : 'green'} />
        <StatCard label="Due today" value={data.dueToday.length} tone="orange" sub={timezone} />
        <StatCard label="This week" value={data.thisWeek.length} sub={`through ${data.weekEnd}`} tone="blue" />
        <StatCard label="Done today" value={doneToday} tone="green" />
      </div>

      {blockingOpen > 0 && (
        <div className="card" style={{ background: 'var(--marmalade-soft)', marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Lock size={16} style={{ color: 'var(--marmalade-deep)' }} />
            <span style={{ fontSize: 13.5, color: 'var(--marmalade-deep)' }}>
              <b>{blockingOpen} mandatory task{blockingOpen > 1 ? 's' : ''}</b> must be finished before you can log out today.
            </span>
          </div>
        </div>
      )}

      <div className="page-head">
        <div className="spacer" />
        <div className="filters">
          <button className={`btn sm ${view === 'list' ? '' : 'ghost'}`} onClick={() => setView('list')}><LayoutList size={13} /> List</button>
          <button className={`btn sm ${view === 'board' ? '' : 'ghost'}`} onClick={() => setView('board')}><Columns3 size={13} /> Board</button>
        </div>
      </div>

      {nothing && <div className="card"><Empty emoji="🎉" text="Nothing assigned to you right now" /></div>}

      {view === 'list' ? (
        groups.filter((g) => g.rows.length).map((g) => (
          <div key={g.key} style={{ marginBottom: 22 }}>
            <div className="nav-label" style={{ color: 'var(--ink-soft)', padding: '0 0 8px' }}>
              {g.title} ({g.rows.length})
            </div>
            {g.rows.map((inst) => (
              <TaskCard key={inst.id} inst={inst} today={today} actions={<Actions inst={inst} act={act} />} />
            ))}
          </div>
        ))
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
          {groups.filter((g) => g.rows.length).map((g) => (
            <div key={g.key}>
              <div className="nav-label" style={{ color: 'var(--ink-soft)', padding: '0 0 8px' }}>
                {g.title} ({g.rows.length})
              </div>
              {g.rows.map((inst) => (
                <TaskCard key={inst.id} inst={inst} today={today} actions={<Actions inst={inst} act={act} />} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
