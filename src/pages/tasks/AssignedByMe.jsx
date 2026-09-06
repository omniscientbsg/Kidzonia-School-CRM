// My team — the tasks I have handed out, and how they are going.
//
// A list, not a table. One line per task that answers "what, for whom, how
// often, how is it going" at a glance; everything else waits until you open it.
// The old five-column table spent most of its width on empty cells and kept
// four unlabelled icon buttons permanently in view.
import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Pencil, Pause, Play, Ban, RefreshCw, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { Spinner, Empty, Badge, ConfirmDialog } from '../../components/ui'
import { useTasks, useInstances, useTaskProgress, useTaskAct } from '../../services/tasks/api'
import { useOrgLevels } from '../../services/org/api'
import { describeRecurrence } from '../../services/tasks/recurrence'
import { STATUS_LABEL, STATUS_COLOR } from '../../services/tasks/status'
import TaskCard from './TaskCard'

// "Every Teacher", "4 people", "Everyone at Jubilee Hills" — what a person would
// say out loud, not the name of the targeting mode.
function whoFor(task, levels) {
  const t = task.target || {}
  if (t.kind === 'position' || t.kind === 'user') {
    const n = (t.positionIds?.length || 0) + (t.userIds?.length || 0)
    return n === 1 ? '1 person' : `${n} people`
  }
  if (t.kind === 'node_level') {
    // levelIds is the current shape; levelId is what tasks saved before
    // multi-role targeting carry. Reading only the first one made "every
    // Teacher AND Day Care Staff" read as "Every Teacher".
    const ids = t.levelIds?.length ? t.levelIds : [t.levelId].filter(Boolean)
    const names = ids.map((id) => levels.find((l) => l.id === id)?.name).filter(Boolean)
    if (!names.length) return 'Everyone at that tier'
    if (names.length === 1) return `Every ${names[0]}`
    return `Every ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  if (t.kind === 'node') return `Everyone at ${t.nodeIds?.length === 1 ? 'that school' : `${t.nodeIds?.length || 0} schools`}`
  return 'Everyone below me'
}

function Bar({ pct }) {
  return (
    <div style={{ width: 84, height: 6, background: '#efece4', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? 'var(--teal)' : pct >= 50 ? 'var(--marmalade)' : 'var(--berry)' }} />
    </div>
  )
}

// Opened: who has done it, who has not. The one question this page exists for.
function Detail({ task, onEdit, onPause, onCancel, onGenerate, busy }) {
  const { data, isLoading } = useTaskProgress(task.id)
  const { data: rows = [] } = useInstances({ taskId: task.id })
  const [showOccurrences, setShowOccurrences] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const recent = rows.filter((r) => r.serviceDate <= today).slice(-12)

  return (
    <div style={{ padding: '4px 0 6px 26px' }}>
      {task.description && <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--ink-soft)' }}>{task.description}</p>}
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{task.conditionSummary}</div>

      {isLoading ? <Spinner /> : !data?.people?.length ? (
        <span className="muted" style={{ fontSize: 12.5 }}>Nothing has been generated for this yet.</span>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {data.people.map((p) => (
            <div key={p.positionId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 150 }}>
                <b style={{ fontSize: 13 }}>{p.userName}</b>
                <div className="muted" style={{ fontSize: 11.5 }}>{p.tier}</div>
              </div>
              <Bar pct={p.pct} />
              <span style={{ fontSize: 12.5, minWidth: 44 }}>{p.done}/{p.total}</span>
              {p.overdue > 0 && <Badge color="red">{p.overdue} late</Badge>}
              <div className="spacer" />
              <Badge color={STATUS_COLOR[p.latestStatus]}>{STATUS_LABEL[p.latestStatus]}</Badge>
              <span className="muted" style={{ fontSize: 11.5 }}>{p.latestServiceDate}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {task.status !== 'cancelled' && (
          <>
            <button className="btn sm ghost" onClick={onEdit}><Pencil size={12} /> Edit</button>
            <button className="btn sm ghost" onClick={onPause}>
              {task.status === 'paused' ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </button>
            <button className="btn sm ghost" disabled={busy} onClick={onGenerate}><RefreshCw size={12} /> Catch up</button>
            <button className="btn sm ghost" onClick={onCancel}><Ban size={12} /> Cancel</button>
          </>
        )}
        {recent.length > 0 && (
          <button className="btn sm ghost" onClick={() => setShowOccurrences(!showOccurrences)}>
            {showOccurrences ? 'Hide' : 'Show'} the last {recent.length} days
          </button>
        )}
      </div>

      {showOccurrences && (
        <div style={{ marginTop: 10 }}>
          {recent.map((inst) => <TaskCard key={inst.id} inst={inst} today={today} showAssignee />)}
        </div>
      )}
    </div>
  )
}

export default function AssignedByMe() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { data: tasks = [], isLoading, isError, error } = useTasks()
  const { data: levels = [] } = useOrgLevels()
  const act = useTaskAct()
  const [open, setOpen] = useState(state?.openTaskId || null)
  const [confirm, setConfirm] = useState(null)
  const [showCancelled, setShowCancelled] = useState(false)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load tasks'} /></div>

  const rows = tasks.filter((t) => showCancelled || t.status !== 'cancelled')
  if (!rows.length) {
    return (
      <div className="card">
        <Empty emoji="📋" text="You have not assigned anything yet" />
        <div style={{ textAlign: 'center' }}>
          <button className="btn" onClick={() => navigate('/tasks/new')}>Assign your first task</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head" style={{ gap: 8 }}>
        <Link className="btn sm ghost" to="/tasks/blocked">Who is stuck</Link>
        <Link className="btn sm ghost" to="/tasks/day-end/received">Day-end reports</Link>
        <div className="spacer" />
        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} style={{ width: 'auto' }} />
          Show cancelled
        </label>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.map((task, i) => {
          const isOpen = open === task.id
          const Chevron = isOpen ? ChevronDown : ChevronRight
          return (
            <div key={task.id} style={{ borderTop: i ? '1px solid var(--line)' : 'none', padding: '12px 16px' }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : task.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                <Chevron size={15} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 14 }}>{task.title}</b>
                    {task.isBlocking && <Badge color="orange"><Lock size={9} style={{ verticalAlign: -1 }} /> mandatory</Badge>}
                    {task.status === 'paused' && <Badge color="yellow">paused</Badge>}
                    {task.status === 'cancelled' && <Badge color="gray">cancelled</Badge>}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {whoFor(task, levels)} · {describeRecurrence(task.recurrence)}
                    {task.requiresApproval && ' · needs sign-off'}
                    {task.requiresMedia && ` · ${task.minAttachments} photo${task.minAttachments > 1 ? 's' : ''}`}
                  </div>
                </div>
                {!isOpen && task.progress?.total > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {task.progress.overdue > 0 && <Badge color="red">{task.progress.overdue} late</Badge>}
                    <Bar pct={task.progress.pct} />
                    <span style={{ fontSize: 12.5, minWidth: 34, textAlign: 'right' }}>{task.progress.pct}%</span>
                  </div>
                )}
              </button>
              {isOpen && (
                <Detail
                  task={task} busy={act.isPending}
                  onEdit={() => navigate(`/tasks/${task.id}/edit`)}
                  onPause={() => act.mutate({ path: `/tasks/${task.id}/pause`, success: task.status === 'paused' ? 'Resumed' : 'Paused' })}
                  onCancel={() => setConfirm(task)}
                  onGenerate={() => act.mutate({ path: '/tasks/generate', body: { taskId: task.id }, success: 'Up to date' })}
                />
              )}
            </div>
          )
        })}
      </div>

      {confirm && (
        <ConfirmDialog
          title={`Cancel “${confirm.title}”?`}
          message="Anything unfinished is cancelled too. Work already done is kept."
          confirmLabel="Cancel task"
          busy={act.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate(
            { path: `/tasks/${confirm.id}/cancel`, body: { reason: 'Cancelled by assigner' }, success: 'Task cancelled' },
            { onSuccess: () => setConfirm(null), onError: () => setConfirm(null) }
          )}
        />
      )}
    </div>
  )
}
