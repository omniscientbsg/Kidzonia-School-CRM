import { useState } from 'react'
import { UserPlus, Info } from 'lucide-react'
import { Modal, Field, Empty, Spinner } from '../../components/ui'
import { useUnplacedStaff, useOrgAct } from '../../services/org/api'
import { levelUsableAt, canCreateLevel, NODE_TYPE_LABEL } from '../../services/org/tree'

// Import from the user master — never re-register.
// These people already exist in `users`; placing them just adds an
// orgPositions row pointing at the same id.
export default function ImportStaffModal({ nodes, nodeById, levels, myPositions, onClose }) {
  const { data: unplaced = [], isLoading } = useUnplacedStaff()
  const act = useOrgAct()
  const [nodeId, setNodeId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [picked, setPicked] = useState([])
  const [q, setQ] = useState('')

  const node = nodeById[nodeId]
  const usable = node
    ? levels.filter((l) => levelUsableAt(l, node) && canCreateLevel(myPositions, node, l.rank, nodeById))
    : []
  const placeable = nodes.filter((n) => levels.some((l) => levelUsableAt(l, n) && canCreateLevel(myPositions, n, l.rank, nodeById)))
  const shown = unplaced.filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || (u.employeeId || '').toLowerCase().includes(q.toLowerCase()))
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <Modal title="Import people from the staff directory" onClose={onClose} wide>
      <div className="card" style={{ background: 'var(--sky-soft, #eaf2fb)', boxShadow: 'none', marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          These people already exist in the staff directory. Placing them here only adds a reporting
          line — no second account is created, and their login is unchanged.
        </span>
      </div>

      {isLoading ? <Spinner /> : (
        <>
          <div className="form-row">
            <Field label="Place at *">
              <select value={nodeId} onChange={(e) => { setNodeId(e.target.value); setLevelId('') }}>
                <option value="">— choose node —</option>
                {placeable.map((n) => (
                  <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.name} ({NODE_TYPE_LABEL[n.type]})</option>
                ))}
              </select>
            </Field>
            <Field label="As tier *">
              <select value={levelId} onChange={(e) => setLevelId(e.target.value)} disabled={!nodeId}>
                <option value="">— choose tier —</option>
                {usable.sort((x, y) => x.rank - y.rank).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label={`Not yet placed (${picked.length} selected of ${unplaced.length})`}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee id…" style={{ marginBottom: 8 }} />
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 9, padding: 8 }}>
              {shown.length === 0 && <span className="muted">Everyone in the directory already has a position. 🎉</span>}
              {shown.map((u) => (
                <label key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 2px', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} style={{ width: 'auto' }} />
                  <b>{u.name}</b>
                  <span className="muted">{u.designation || u.role}{u.employeeId ? ` · ${u.employeeId}` : ''}</span>
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn"
          disabled={!picked.length || !nodeId || !levelId || act.isPending}
          onClick={() => act.mutate(
            { path: '/org/positions/import', body: { userIds: picked, nodeId, levelId }, success: `Placed ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` },
            { onSuccess: onClose },
          )}
        >
          <UserPlus size={13} /> Place {picked.length || ''}
        </button>
      </div>
    </Modal>
  )
}
