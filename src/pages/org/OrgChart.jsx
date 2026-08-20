import { useState } from 'react'
import { Plus, Pencil, MoveRight, Trash2, ChevronDown, ChevronRight, Building2, ArrowUp } from 'lucide-react'
import { useGet } from '../../api/hooks'
import { Spinner, Empty, Badge, StatCard, ConfirmDialog } from '../../components/ui'
import { useOrgTree, useOrgMe, useOrgAct, useAncestors } from '../../services/org/api'
import { flattenTree, NODE_TYPE_LABEL } from '../../services/org/tree'
import NodeModal from './NodeModal'

const TYPE_COLOR = { hq: 'plum', region: '', franchise: 'orange', school: 'green', department: 'gray' }

function NodeCard({ node, depth, onAdd, onEdit, onMove, onDelete }) {
  const [open, setOpen] = useState(true)
  const kids = node.children || []
  return (
    <div style={{ marginLeft: depth ? 26 : 0, borderLeft: depth ? '2px solid var(--line)' : 'none', paddingLeft: depth ? 16 : 0 }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: node.positions.length ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            {kids.length > 0 ? (
              <button className="icon-btn" onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Expand'} style={{ width: 26, height: 26 }}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span style={{ width: 26, display: 'inline-block' }} />
            )}
            <Building2 size={16} style={{ color: 'var(--marmalade)' }} />
            <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{node.name}</b>
            <Badge color={TYPE_COLOR[node.type]}>{NODE_TYPE_LABEL[node.type]}</Badge>
            {node.isFranchise && <Badge color="orange">Franchise</Badge>}
            <span className="muted">level {node.depth} · {node.timezone}</span>
            {node.settings?.blockingLogoutEnabled === false && <span className="muted">· logout gate off</span>}
          </div>
          {node.canAdminister && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm subtle" onClick={() => onAdd(node)}><Plus size={13} /> Sub-node</button>
              <button className="icon-btn" title="Edit" onClick={() => onEdit(node)}><Pencil size={14} /></button>
              {node.parentId && <button className="icon-btn" title="Move" onClick={() => onMove(node)}><MoveRight size={14} /></button>}
              {node.parentId && <button className="icon-btn" title="Deactivate" onClick={() => onDelete(node)}><Trash2 size={14} /></button>}
            </div>
          )}
        </div>
        {node.positions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {node.positions.map((p) => (
              <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '6px 10px', fontSize: 12.5, background: '#fff' }}>
                <b>{p.userName}</b>
                <div className="muted">{p.tier}{p.manageable ? ' · in your downline' : ''}</div>
              </div>
            ))}
          </div>
        )}
        {node.positions.length === 0 && <span className="muted">No one placed here yet.</span>}
      </div>
      {open && kids.map((c) => (
        <NodeCard key={c.id} node={c} depth={depth + 1} onAdd={onAdd} onEdit={onEdit} onMove={onMove} onDelete={onDelete} />
      ))}
    </div>
  )
}

export default function OrgChart() {
  const { data, isLoading, isError, error } = useOrgTree()
  const { data: me } = useOrgMe()
  const { data: ancestors = [] } = useAncestors()
  const { data: branches = [] } = useGet('/branches')
  const act = useOrgAct()
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load the org tree'} /></div>
  if (!data?.tree) return <div className="card"><Empty emoji="🌳" text="No organisation tree yet" /></div>

  const { flat } = flattenTree(data.tree)
  const schools = flat.filter((n) => n.type === 'school')
  const people = flat.reduce((sum, n) => sum + n.positions.length, 0)
  const maxDepth = Math.max(...flat.map((n) => n.depth))

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="Nodes" value={flat.length} sub={`${maxDepth + 1} levels deep`} />
        <StatCard label="Schools" value={schools.length} sub={`${schools.filter((s) => s.isFranchise).length} franchise`} tone="green" />
        <StatCard label="People placed" value={people} tone="blue" />
        <StatCard label="Your downline" value={me?.downlineCount ?? '—'} sub={me?.tier || ''} tone="orange" />
      </div>

      <p className="muted" style={{ marginBottom: 14 }}>
        Depth is relative to each branch: a franchise school sits one level deeper than a company-owned one.
        Who can assign to whom is decided by ancestry in this tree, never by the level number.
      </p>

      {ancestors.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            <b>Your reporting line</b>
            <span className="muted">Everyone who can assign to you or approve your work</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span className="badge orange">You · {me?.tier} · level {me?.depth}</span>
            {ancestors.map((p) => (
              <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ArrowUp size={12} style={{ color: 'var(--ink-faint)' }} />
                <span className="badge gray">{p.userName} · {p.tier} · level {p.depth}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <NodeCard
        node={data.tree}
        depth={0}
        onAdd={(n) => setModal({ mode: 'create', parent: n })}
        onEdit={(n) => setModal({ mode: 'edit', node: n })}
        onMove={(n) => setModal({ mode: 'move', node: n })}
        onDelete={(n) => setConfirm(n)}
      />

      {modal && (
        <NodeModal
          mode={modal.mode}
          node={modal.node}
          parent={modal.parent}
          allNodes={flat}
          branches={branches}
          onClose={() => setModal(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={`Deactivate ${confirm.name}?`}
          message="Child nodes and active positions must be moved or ended first. Task history is kept."
          confirmLabel="Deactivate"
          busy={act.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate(
            { method: 'del', path: `/org/nodes/${confirm.id}`, success: 'Node deactivated' },
            { onSuccess: () => setConfirm(null), onError: () => setConfirm(null) }
          )}
        />
      )}
    </div>
  )
}
