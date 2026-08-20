import { useState } from 'react'
import { Plus, UserMinus, Download, AlertTriangle } from 'lucide-react'
import { useGet } from '../../api/hooks'
import { Spinner, Empty, Badge, Modal, Field, ConfirmDialog } from '../../components/ui'
import { useOrgTree, useOrgMe, useOrgLevels, useOrgPositions, useOrgAct, useUnplacedStaff } from '../../services/org/api'
import { flattenTree, canCreateLevel, levelUsableAt, NODE_TYPE_LABEL } from '../../services/org/tree'
import ImportStaffModal from './ImportStaffModal'

function PositionModal({ nodes, nodeById, levels, staff, myPositions, onClose }) {
  const act = useOrgAct()
  const [form, setForm] = useState({ userId: '', nodeId: '', levelId: '', title: '' })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const node = nodeById[form.nodeId]
  // only tiers in scope for that node, and only below the actor's own level
  const usable = node
    ? levels.filter((l) => levelUsableAt(l, node) && canCreateLevel(myPositions, node, l.rank, nodeById))
    : []
  const placeableNodes = nodes.filter((n) => levels.some((l) => levelUsableAt(l, n) && canCreateLevel(myPositions, n, l.rank, nodeById)))

  function save() {
    act.mutate({
      path: '/org/positions',
      body: { userId: form.userId, nodeId: form.nodeId, levelId: form.levelId, title: form.title.trim() || null },
      success: 'Position created',
    }, { onSuccess: onClose })
  }

  return (
    <Modal title="Place someone in the org" onClose={onClose}>
      <Field label="Staff member *">
        <select value={form.userId} onChange={(e) => set('userId', e.target.value)}>
          <option value="">— choose person —</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.designation || u.role}</option>)}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Node *">
          <select value={form.nodeId} onChange={(e) => { set('nodeId', e.target.value); set('levelId', '') }}>
            <option value="">— choose node —</option>
            {placeableNodes.map((n) => (
              <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.name} ({NODE_TYPE_LABEL[n.type]})</option>
            ))}
          </select>
        </Field>
        <Field label="Tier *">
          <select value={form.levelId} onChange={(e) => set('levelId', e.target.value)} disabled={!form.nodeId}>
            <option value="">— choose tier —</option>
            {usable.sort((a, b) => a.rank - b.rank).map((l) => <option key={l.id} value={l.id}>{l.name} (rank {l.rank})</option>)}
          </select>
        </Field>
      </div>
      <Field label="Display title (optional)">
        <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Senior Teacher" />
      </Field>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Only nodes and tiers strictly below your own level are listed. A person may hold several positions.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.userId || !form.nodeId || !form.levelId || act.isPending} onClick={save}>Place</button>
      </div>
    </Modal>
  )
}

export default function Positions() {
  const { data: tree, isLoading: treeLoading } = useOrgTree()
  const { data: me } = useOrgMe()
  const { data: levels = [] } = useOrgLevels()
  const { data: positions = [], isLoading, isError, error } = useOrgPositions()
  const { data: staff = [] } = useGet('/staff')
  const { data: unplaced = [] } = useUnplacedStaff()
  const act = useOrgAct()
  const [modal, setModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [nodeFilter, setNodeFilter] = useState('')
  const [q, setQ] = useState('')

  if (isLoading || treeLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load positions'} /></div>

  const { flat, nodeById } = flattenTree(tree?.tree)
  const myPositions = me?.positions || []
  const rows = positions
    .filter((p) => !nodeFilter || p.nodeId === nodeFilter)
    .filter((p) => !q || p.userName.toLowerCase().includes(q.toLowerCase()) || p.tier.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.depth - b.depth || a.rank - b.rank || a.userName.localeCompare(b.userName))
  const canPlace = flat.some((n) => levels.some((l) => levelUsableAt(l, n) && canCreateLevel(myPositions, n, l.rank, nodeById)))

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <select value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)}>
            <option value="">All nodes</option>
            {flat.map((n) => <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.name}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person or tier…" />
        </div>
        <div className="spacer" />
        {canPlace && (
          <>
            <button className="btn subtle" onClick={() => setImporting(true)}>
              <Download size={14} /> Import from staff directory
              {unplaced.length > 0 ? " (" + unplaced.length + ")" : ""}
            </button>
            <button className="btn" onClick={() => setModal(true)}><Plus size={14} /> Place someone</button>
          </>
        )}
      </div>

      {unplaced.length > 0 && (
        <div className="card" style={{ background: "var(--sun-soft)", boxShadow: "none", marginBottom: 14 }}>
          <span style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", color: "#ad7a12" }}>
            <AlertTriangle size={15} />
            <b>{unplaced.length} {unplaced.length === 1 ? "person is" : "people are"} in the staff directory but not in the org chart</b>
            — they cannot be assigned tasks or appear in any roll-up until placed.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card"><Empty emoji="👥" text="No positions match" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Person</th><th>Tier</th><th>Node</th><th>Level</th><th>Rank</th><th>Reach</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.userName}</b>{p.isPrimary ? '' : <span className="muted"> · secondary</span>}</td>
                  <td>{p.tier}</td>
                  <td>{p.nodeName} <span className="muted">{NODE_TYPE_LABEL[nodeById[p.nodeId]?.type] || ''}</span></td>
                  <td>{p.depth}</td>
                  <td>{p.rank}</td>
                  <td>
                    {p.id === me?.primaryPositionId
                      ? <Badge color="plum">you</Badge>
                      : p.manageable
                        ? <Badge color="green">in your downline</Badge>
                        : <span className="muted">—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {p.manageable && (
                      <button className="icon-btn" title="End position" onClick={() => setConfirm(p)}><UserMinus size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importing && (
        <ImportStaffModal
          nodes={flat}
          nodeById={nodeById}
          levels={levels}
          myPositions={myPositions}
          onClose={() => setImporting(false)}
        />
      )}
      {modal && (
        <PositionModal
          nodes={flat}
          nodeById={nodeById}
          levels={levels}
          staff={staff}
          myPositions={myPositions}
          onClose={() => setModal(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={`End ${confirm.userName}'s position?`}
          message={`They stop being ${confirm.tier} at ${confirm.nodeName} and lose that reporting line. Past tasks keep pointing at this position.`}
          confirmLabel="End position"
          busy={act.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate(
            { path: `/org/positions/${confirm.id}/end`, body: { reason: 'Ended from Positions screen' }, success: 'Position ended' },
            { onSuccess: () => setConfirm(null), onError: () => setConfirm(null) }
          )}
        />
      )}
    </div>
  )
}
