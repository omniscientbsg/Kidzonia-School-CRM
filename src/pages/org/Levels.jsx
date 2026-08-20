import { useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { Spinner, Empty, Badge, Modal, Field } from '../../components/ui'
import { useOrgTree, useOrgMe, useOrgLevels, useOrgAct } from '../../services/org/api'
import { flattenTree, canCreateLevel, SCOPE_KIND_LABEL, SCOPE_KIND_TYPES, NODE_TYPE_LABEL } from '../../services/org/tree'

function LevelModal({ level, nodes, myPositions, nodeById, onClose }) {
  const act = useOrgAct()
  const editing = !!level
  const [form, setForm] = useState({
    name: level?.name || '',
    scopeNodeId: level?.scopeNodeId || nodes[0]?.id || '',
    scopeKind: level?.scopeKind || 'school',
    rank: level?.rank ?? 60,
    color: level?.color || '#f4772e',
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const scopeNode = nodeById[form.scopeNodeId]
  const allowed = canCreateLevel(myPositions, scopeNode, Number(form.rank), nodeById)

  function save() {
    const body = { name: form.name.trim(), scopeNodeId: form.scopeNodeId, scopeKind: form.scopeKind, rank: Number(form.rank), color: form.color }
    if (editing) act.mutate({ method: 'put', path: `/org/levels/${level.id}`, body, success: 'Level updated' }, { onSuccess: onClose })
    else act.mutate({ path: '/org/levels', body, success: 'Level created' }, { onSuccess: onClose })
  }

  return (
    <Modal title={editing ? `Edit ${level.name}` : 'New level'} onClose={onClose}>
      <div className="form-row">
        <Field label="Tier name *">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Lab Assistant" autoFocus />
        </Field>
        <Field label="Seniority rank *">
          <input type="number" value={form.rank} onChange={(e) => set('rank', e.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Defined at (scope)">
          <select value={form.scopeNodeId} onChange={(e) => set('scopeNodeId', e.target.value)} disabled={editing}>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Usable at">
          <select value={form.scopeKind} onChange={(e) => set('scopeKind', e.target.value)} disabled={editing}>
            {Object.keys(SCOPE_KIND_TYPES).map((k) => <option key={k} value={k}>{SCOPE_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
      </div>
      <p className="muted" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
        Lower rank = more senior. The tier is only available inside <b>{scopeNode?.name || 'the chosen node'}</b> and below —
        sibling schools never see it. You can only define tiers strictly below your own.
      </p>
      {!allowed && (
        <div className="card" style={{ background: 'var(--berry-soft)', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--berry)' }}>
            That scope or rank is at or above your own level — the server will refuse it.
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.name.trim() || !allowed || act.isPending} onClick={save}>
          {editing ? 'Save' : 'Create level'}
        </button>
      </div>
    </Modal>
  )
}

export default function Levels() {
  const { data: tree, isLoading: treeLoading } = useOrgTree()
  const { data: me } = useOrgMe()
  const { data: levels = [], isLoading, isError, error } = useOrgLevels()
  const [modal, setModal] = useState(null)

  if (isLoading || treeLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load levels'} /></div>

  const { flat, nodeById } = flattenTree(tree?.tree)
  const myPositions = me?.positions || []
  const byScope = flat
    .map((n) => ({ node: n, rows: levels.filter((l) => l.scopeNodeId === n.id).sort((a, b) => a.rank - b.rank) }))
    .filter((g) => g.rows.length)

  const canCreateAnywhere = flat.some((n) => canCreateLevel(myPositions, n, 999, nodeById))

  return (
    <div>
      <div className="page-head">
        <span className="muted" style={{ maxWidth: 640, lineHeight: 1.5 }}>
          Tiers are display labels with a seniority rank. HQ defines tiers for HQ and every school;
          a school can only define tiers inside its own subtree.
        </span>
        <div className="spacer" />
        {canCreateAnywhere && (
          <button className="btn" onClick={() => setModal({})}><Plus size={14} /> New level</button>
        )}
      </div>

      {byScope.length === 0 && <div className="card"><Empty emoji="🏷️" text="No levels defined yet" /></div>}

      {byScope.map(({ node, rows }) => (
        <div className="card" key={node.id}>
          <div className="card-title">
            <div>
              <b style={{ fontFamily: 'var(--font-display)' }}>{node.name}</b>{' '}
              <span className="muted">scope · {NODE_TYPE_LABEL[node.type]} · usable in this subtree only</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Tier</th><th>Rank</th><th>Usable at</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="badge" style={{ background: `${l.color}22`, color: l.color }}>{l.name}</span>
                    </td>
                    <td>{l.rank}<span className="muted"> {l.rank === 0 ? '(most senior)' : ''}</span></td>
                    <td className="muted">{SCOPE_KIND_LABEL[l.scopeKind]}</td>
                    <td><Badge status={l.active === false ? 'cancelled' : 'active'} /></td>
                    <td style={{ textAlign: 'right' }}>
                      {canCreateLevel(myPositions, node, l.rank, nodeById) && (
                        <button className="icon-btn" title="Edit" onClick={() => setModal({ level: l })}><Pencil size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {modal && (
        <LevelModal
          level={modal.level}
          nodes={flat}
          nodeById={nodeById}
          myPositions={myPositions}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
