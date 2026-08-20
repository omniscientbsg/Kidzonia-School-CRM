import { useState } from 'react'
import { Plus, Check, Pencil, Copy, Archive, RotateCcw, School, Users } from 'lucide-react'
import { useGet, useAct, fmtDate } from '../../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

const SETUP_ROLES = ['super_admin', 'branch_admin']

// Shared add / edit / clone form. `mode` = 'add' | 'edit' | 'clone'.
function SessionModal({ mode, session, branches, isSuper, onClose }) {
  const act = useAct(['/academic-years', '/session-stats'])
  const [form, setForm] = useState({
    name: mode === 'edit' ? session.name : '',
    startDate: mode === 'edit' ? session.startDate : '',
    endDate: mode === 'edit' ? session.endDate : '',
    branchId: session?.branchId || branches[0]?.id || '',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const datesOk = form.startDate && form.endDate && form.endDate > form.startDate
  const valid = form.name.trim() && datesOk && (!isSuper || mode !== 'add' || form.branchId)

  function submit() {
    const body = { name: form.name.trim(), startDate: form.startDate, endDate: form.endDate }
    if (mode === 'add') {
      if (isSuper) body.branchId = form.branchId
      act.mutate({ path: '/academic-years', body, success: 'Session created' }, { onSuccess: onClose })
    } else if (mode === 'edit') {
      act.mutate({ method: 'put', path: `/academic-years/${session.id}`, body, success: 'Session updated' }, { onSuccess: onClose })
    } else {
      act.mutate({ path: `/academic-years/${session.id}/clone`, body, success: 'Session cloned — classes & teachers copied' }, { onSuccess: onClose })
    }
  }

  const title = mode === 'add' ? 'New session' : mode === 'edit' ? 'Edit session' : `Clone “${session.name}” to new session`
  return (
    <Modal title={title} onClose={onClose}>
      {mode === 'clone' && (
        <p style={{ margin: '0 0 14px', color: 'var(--ink-soft)', fontSize: 13, lineHeight: 1.5 }}>
          Copies all classes, sections and teacher assignments into the new session. Students are <b>not</b> carried over.
        </p>
      )}
      <Field label="Session name"><input value={form.name} onChange={set('name')} placeholder="e.g. 2027-2028" autoFocus /></Field>
      <div className="form-row">
        <Field label="Start date"><input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
        <Field label="End date"><input type="date" value={form.endDate} onChange={set('endDate')} /></Field>
      </div>
      {form.startDate && form.endDate && !datesOk && (
        <div className="muted" style={{ color: 'var(--berry)', fontSize: 12.5, marginTop: -6, marginBottom: 10 }}>End date must be after start date.</div>
      )}
      {isSuper && mode === 'add' && (
        <Field label="Branch">
          <select value={form.branchId} onChange={set('branchId')}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn ghost" onClick={onClose} disabled={act.isPending}>Cancel</button>
        <button className="btn" disabled={!valid || act.isPending} onClick={submit}>
          {mode === 'add' ? 'Create session' : mode === 'edit' ? 'Save changes' : 'Clone session'}
        </button>
      </div>
    </Modal>
  )
}

function SessionCard({ s, stat, isSuper, branchName, canManage, viewing, onActivate, onEdit, onClone, onArchive }) {
  return (
    <div
      className="card"
      style={{
        borderColor: s.active ? 'var(--marmalade)' : 'var(--line)',
        boxShadow: s.active ? '0 4px 14px rgba(240, 130, 40, 0.18)' : undefined,
        opacity: s.archived ? 0.85 : 1,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>{s.name}</div>
          {isSuper && <div className="muted" style={{ fontSize: 12 }}>{branchName}</div>}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {s.active && <Badge color="orange">active</Badge>}
          {s.archived && <Badge color="gray">archived</Badge>}
          {!s.active && !s.archived && <Badge color="yellow">inactive</Badge>}
          {viewing && !s.active && <Badge color="plum">viewing</Badge>}
        </div>
      </div>

      <div className="muted" style={{ fontSize: 13 }}>
        {fmtDate(s.startDate)} <span style={{ opacity: 0.6 }}>→</span> {fmtDate(s.endDate)}
      </div>

      <div style={{ display: 'flex', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <School size={15} style={{ opacity: 0.6 }} />
          <b>{stat ? stat.classes : '—'}</b> <span className="muted" style={{ fontSize: 12.5 }}>classes</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={15} style={{ opacity: 0.6 }} />
          <b>{stat ? stat.students : '—'}</b> <span className="muted" style={{ fontSize: 12.5 }}>students</span>
        </div>
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
          {s.archived ? (
            <>
              <button className="btn sm subtle" onClick={onArchive}><RotateCcw size={13} /> Restore</button>
              <button className="btn sm ghost" onClick={onClone}><Copy size={13} /> Clone</button>
            </>
          ) : (
            <>
              {!s.active && <button className="btn sm subtle" onClick={onActivate}><Check size={13} /> Activate</button>}
              <button className="btn sm ghost" onClick={onEdit}><Pencil size={13} /> Edit</button>
              <button className="btn sm ghost" onClick={onClone}><Copy size={13} /> Clone</button>
              {!s.active && <button className="btn sm ghost" onClick={onArchive}><Archive size={13} /> Archive</button>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function Sessions() {
  const { user, activeSessionId, setActiveSession } = useStore()
  const isSuper = user.role === 'super_admin'
  const canManage = SETUP_ROLES.includes(user.role)
  const { data: sessions = [], isLoading } = useGet('/academic-years')
  const { data: branches = [] } = useGet('/branches')
  const { data: stats = [] } = useGet('/session-stats')
  const act = useAct(['/academic-years', '/session-stats'])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null) // { mode, session }

  if (isLoading) return <Spinner />

  const statBy = Object.fromEntries(stats.map((x) => [x.sessionId, x]))
  const branchName = (id) => branches.find((b) => b.id === id)?.name || '—'
  const filtered = sessions
    .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(a.archived) - Number(b.archived) || (b.startDate || '').localeCompare(a.startDate || ''))

  function activate(s) {
    act.mutate(
      { method: 'put', path: `/academic-years/${s.id}/activate`, body: {}, success: `${s.name} is now the active session` },
      { onSuccess: () => setActiveSession(s.id) }
    )
  }
  function toggleArchive(s) {
    const archiving = !s.archived
    act.mutate({
      method: 'put', path: `/academic-years/${s.id}/archive`, body: { archived: archiving },
      success: archiving ? `${s.name} archived` : `${s.name} restored`,
    })
  }

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions…" />
        </div>
        <div className="spacer" />
        {canManage && <button className="btn" onClick={() => setModal({ mode: 'add' })}><Plus size={15} /> Add session</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="card"><Empty emoji="📅" text="No sessions found" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map((s) => (
            <SessionCard
              key={s.id}
              s={s}
              stat={statBy[s.id]}
              isSuper={isSuper}
              branchName={branchName(s.branchId)}
              canManage={canManage}
              viewing={activeSessionId === s.id}
              onActivate={() => activate(s)}
              onEdit={() => setModal({ mode: 'edit', session: s })}
              onClone={() => setModal({ mode: 'clone', session: s })}
              onArchive={() => toggleArchive(s)}
            />
          ))}
        </div>
      )}

      {modal && (
        <SessionModal
          mode={modal.mode}
          session={modal.session}
          branches={branches}
          isSuper={isSuper}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
