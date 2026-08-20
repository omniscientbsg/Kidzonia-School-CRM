import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, ArrowLeft, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import { useGet } from '../../../api/hooks'
import { api } from '../../../api/client'
import { Spinner, Empty, Badge, Field, Modal } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

const SETUP_ROLES = ['super_admin', 'branch_admin']

export default function TransferClass() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, activeSessionId } = useStore()
  const canManage = SETUP_ROLES.includes(user.role)
  const [saving, setSaving] = useState(false)

  const { data: sessions = [], isLoading: lsess } = useGet('/academic-years')
  const { data: classes = [] } = useGet('/classes')
  const { data: sections = [] } = useGet('/sections')

  const defaultSession = activeSessionId || sessions.find((s) => s.active)?.id || ''
  const [fromSessionId, setFromSessionId] = useState(defaultSession)
  const [toSessionId, setToSessionId] = useState(defaultSession)
  const [fromClassId, setFromClassId] = useState('')
  const [toClassId, setToClassId] = useState('')
  const [toSectionId, setToSectionId] = useState('')
  const [q, setQ] = useState('')
  const [deselected, setDeselected] = useState(() => new Set()) // held-back students
  const [confirm, setConfirm] = useState(false)
  const [overCap, setOverCap] = useState(null) // {capacity,current,incoming}

  const { data: fromData, isLoading: lroster } = useGet(fromClassId ? `/classes/${fromClassId}/roster` : '/health', { enabled: !!fromClassId })
  const { data: toData } = useGet(toClassId ? `/classes/${toClassId}/roster` : '/health', { enabled: !!toClassId })

  if (lsess) return <Spinner />
  if (!canManage) return <div className="card"><Empty emoji="🔒" text="You don't have permission to transfer students." /></div>

  const openSessions = sessions.filter((s) => !s.archived)
  const fromBranch = sessions.find((s) => s.id === fromSessionId)?.branchId
  // destination stays within the same branch as the source session
  const toSessionOptions = openSessions.filter((s) => !fromBranch || s.branchId === fromBranch)
  const fromClasses = classes.filter((c) => c.academicYearId === fromSessionId && c.active !== false)
  const toClasses = classes.filter((c) => c.academicYearId === toSessionId && c.active !== false)
  const toSections = sections.filter((s) => s.classId === toClassId)

  const roster = fromData?.students || []
  const selectedIds = roster.filter((s) => !deselected.has(s.id)).map((s) => s.id)
  const shown = roster.filter((s) => {
    if (!q) return true
    return `${s.name} ${s.id} ${s.section}`.toLowerCase().includes(q.toLowerCase())
  })

  const toClass = classes.find((c) => c.id === toClassId)
  const toSection = sections.find((s) => s.id === toSectionId)
  const targetOccupancy = toSection && toData ? toData.students.filter((s) => s.section === toSection.name).length : null
  const willExceed = toSection?.capacity && targetOccupancy != null && targetOccupancy + selectedIds.length > toSection.capacity

  function changeFromClass(id) {
    setFromClassId(id)
    setDeselected(new Set()) // reset to "all selected"
    setQ('')
  }
  function toggleOne(id) {
    setDeselected((d) => {
      const n = new Set(d)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleAll() {
    // if everything currently shown is selected, deselect all shown; else select all
    const allShownSelected = shown.every((s) => !deselected.has(s.id))
    setDeselected((d) => {
      const n = new Set(d)
      for (const s of shown) allShownSelected ? n.add(s.id) : n.delete(s.id)
      return n
    })
  }

  const canReview = fromClassId && toClassId && toSectionId && selectedIds.length > 0 &&
    !(fromClassId === toClassId && fromSessionId === toSessionId)

  async function doTransfer(override = false) {
    setSaving(true)
    try {
      const data = await api.post('/transfers', { fromSessionId, toSessionId, fromClassId, toClassId, toSectionId, studentIds: selectedIds, override })
      toast.success(`Transferred ${data.transferred} student${data.transferred === 1 ? '' : 's'} → ${data.to}`)
      qc.invalidateQueries({ predicate: (query) => ['/class-stats', '/classes'].some((p) => String(query.queryKey[0]).startsWith(p)) })
      setConfirm(false); setOverCap(null)
      navigate('/setup/classes')
    } catch (err) {
      // server rejects an over-capacity move with error:'over_capacity'
      if (err.message === 'over_capacity') {
        setOverCap({ capacity: toSection?.capacity, current: targetOccupancy ?? 0, incoming: selectedIds.length })
      } else {
        toast.error(err.message || 'Transfer failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const fromClassName = classes.find((c) => c.id === fromClassId)?.name
  const toClassName = toClass?.name

  return (
    <div>
      <button className="btn sm ghost" onClick={() => navigate('/setup/classes')} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> Back to classes</button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3>Transfer / Promote students</h3></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'center' }}>
          <div>
            <Field label="From session">
              <select value={fromSessionId} onChange={(e) => { setFromSessionId(e.target.value); setFromClassId(''); }}>
                {openSessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
              </select>
            </Field>
            <Field label="From class">
              <select value={fromClassId} onChange={(e) => changeFromClass(e.target.value)}>
                <option value="">— select —</option>
                {fromClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <ArrowRight size={22} style={{ opacity: 0.5, marginTop: 18 }} />
          <div>
            <Field label="To session">
              <select value={toSessionId} onChange={(e) => { setToSessionId(e.target.value); setToClassId(''); setToSectionId(''); }}>
                {toSessionOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
              </select>
            </Field>
            <div className="form-row">
              <Field label="To class">
                <select value={toClassId} onChange={(e) => { setToClassId(e.target.value); setToSectionId(''); }}>
                  <option value="">— select —</option>
                  {toClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="To section">
                <select value={toSectionId} onChange={(e) => setToSectionId(e.target.value)} disabled={!toClassId}>
                  <option value="">— select —</option>
                  {toSections.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacity ? ` (${s.capacity} seats)` : ''}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </div>

        {toSection && targetOccupancy != null && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Target <b>{toClassName} {toSection.name}</b>: {targetOccupancy}/{toSection.capacity || '∞'} seats filled · transferring {selectedIds.length}
            {willExceed && <span style={{ color: 'var(--berry)', fontWeight: 700 }}> · over capacity</span>}
          </div>
        )}
      </div>

      {!fromClassId ? (
        <div className="card"><Empty emoji="👆" text="Pick a “From” class to load its roster" /></div>
      ) : lroster ? <Spinner /> : roster.length === 0 ? (
        <div className="card"><Empty emoji="🎒" text="No students enrolled in this class" /></div>
      ) : (
        <div>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div className="filters">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" />
            </div>
            <div className="spacer" />
            <span className="muted" style={{ fontSize: 13 }}>{selectedIds.length} of {roster.length} selected {deselected.size > 0 && `· ${deselected.size} held back`}</span>
            <button className="btn" disabled={!canReview} onClick={() => { setOverCap(null); setConfirm(true) }} style={{ marginLeft: 12 }}>
              <ArrowRightLeft size={15} /> Transfer
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={shown.length > 0 && shown.every((s) => !deselected.has(s.id))} onChange={toggleAll} title="Select all" />
                  </th>
                  <th>Admission ID</th>
                  <th>Name</th>
                  <th>Current section</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id}>
                    <td><input type="checkbox" checked={!deselected.has(s.id)} onChange={() => toggleOne(s.id)} /></td>
                    <td className="muted">{s.id}</td>
                    <td><b>{s.name}</b></td>
                    <td><Badge color="gray">{s.section || '—'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <Empty emoji="🔍" text="No students match your search" />}
          </div>
        </div>
      )}

      {confirm && (
        <Modal title="Confirm transfer" onClose={() => { if (!saving) { setConfirm(false); setOverCap(null) } }}>
          <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            Transferring <b>{selectedIds.length}</b> student{selectedIds.length === 1 ? '' : 's'} from <b>{fromClassName}</b> → <b>{toClassName} {toSection?.name}</b>
            {fromSessionId !== toSessionId && <> <span className="muted">({sessions.find((s) => s.id === fromSessionId)?.name} → {sessions.find((s) => s.id === toSessionId)?.name})</span></>}.
          </p>
          {deselected.size > 0 && <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>{deselected.size} student{deselected.size === 1 ? '' : 's'} held back (retained).</p>}

          {overCap ? (
            <div style={{ background: 'var(--berry-soft)', color: 'var(--berry)', padding: '10px 12px', borderRadius: 9, marginBottom: 14, fontSize: 13, display: 'flex', gap: 8 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Target section holds {overCap.current}/{overCap.capacity}; adding {overCap.incoming} exceeds capacity. Transfer anyway?</span>
            </div>
          ) : willExceed ? (
            <div style={{ background: 'var(--sun-soft)', color: '#ad7a12', padding: '10px 12px', borderRadius: 9, marginBottom: 14, fontSize: 13 }}>
              Heads up: this looks like it may exceed the target section capacity.
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => { setConfirm(false); setOverCap(null) }} disabled={saving}>Cancel</button>
            <button className={`btn ${overCap ? 'danger' : ''}`} disabled={saving} onClick={() => doTransfer(!!overCap)}>
              {overCap ? 'Transfer anyway' : 'Confirm transfer'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
