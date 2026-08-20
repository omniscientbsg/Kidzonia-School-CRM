import { useState } from 'react'
import { Modal, Field } from '../../components/ui'
import { useOrgAct } from '../../services/org/api'
import { ALLOWED_PARENT_TYPES, NODE_TYPE_LABEL } from '../../services/org/tree'

// Create a child node, edit a node, or re-parent one. Which types may be
// created is derived from the parent's type — the server re-checks all of it.
export default function NodeModal({ mode, node, parent, allNodes, branches, onClose }) {
  const act = useOrgAct()
  const editing = mode === 'edit'
  const moving = mode === 'move'
  const allowedTypes = parent ? Object.keys(ALLOWED_PARENT_TYPES).filter((t) => ALLOWED_PARENT_TYPES[t].includes(parent.type)) : []

  const [form, setForm] = useState({
    type: node?.type || allowedTypes[0] || 'school',
    name: node?.name || '',
    code: node?.code || '',
    branchId: node?.branchId || '',
    isFranchise: node?.isFranchise ?? parent?.isFranchise ?? false,
    timezone: node?.timezone || parent?.timezone || 'Asia/Kolkata',
    blockingLogoutEnabled: node?.settings?.blockingLogoutEnabled ?? true,
    parentId: node?.parentId || '',
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // a node may not be moved into its own subtree — mirrored from the server
  const moveTargets = allNodes.filter((n) => n.id !== node?.id && !n.path.includes(node?.id) && ALLOWED_PARENT_TYPES[node?.type || '']?.includes(n.type))

  function save() {
    if (moving) {
      act.mutate({ path: `/org/nodes/${node.id}/move`, body: { parentId: form.parentId }, success: 'Node moved' }, { onSuccess: onClose })
      return
    }
    const body = {
      type: form.type,
      name: form.name.trim(),
      code: form.code.trim() || null,
      branchId: form.branchId || null,
      isFranchise: form.isFranchise,
      timezone: form.timezone,
      settings: { blockingLogoutEnabled: form.blockingLogoutEnabled },
    }
    if (editing) act.mutate({ method: 'put', path: `/org/nodes/${node.id}`, body, success: 'Node updated' }, { onSuccess: onClose })
    else act.mutate({ path: '/org/nodes', body: { ...body, parentId: parent.id }, success: 'Node created' }, { onSuccess: onClose })
  }

  const title = moving ? `Move ${node.name}` : editing ? `Edit ${node.name}` : `New node under ${parent?.name}`
  const invalid = moving ? !form.parentId : !form.name.trim() || (form.type === 'school' && !form.branchId)

  return (
    <Modal title={title} onClose={onClose}>
      {moving ? (
        <>
          <Field label="New parent">
            <select value={form.parentId} onChange={(e) => set('parentId', e.target.value)}>
              <option value="">— choose parent —</option>
              {moveTargets.map((n) => (
                <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.name} ({NODE_TYPE_LABEL[n.type]})</option>
              ))}
            </select>
          </Field>
          <p className="muted" style={{ margin: '0 0 14px' }}>
            Everyone in this subtree keeps their tier; only their reporting line changes. Task history is untouched.
          </p>
        </>
      ) : (
        <>
          <div className="form-row">
            <Field label="Name *">
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Kidzonia Kondapur" autoFocus />
            </Field>
            <Field label="Short code">
              <input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. KDP" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Type">
              <select value={form.type} onChange={(e) => set('type', e.target.value)} disabled={editing}>
                {(editing ? [form.type] : allowedTypes).map((t) => (
                  <option key={t} value={t}>{NODE_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </Field>
            <Field label="Time zone">
              <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'UTC'].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
          {form.type === 'school' && (
            <Field label="Linked branch *">
              <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                <option value="">— choose branch —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={form.isFranchise} onChange={(e) => set('isFranchise', e.target.checked)} style={{ width: 'auto' }} />
            Franchise-operated <span className="muted">(label only — reporting lines come from the tree)</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={form.blockingLogoutEnabled} onChange={(e) => set('blockingLogoutEnabled', e.target.checked)} style={{ width: 'auto' }} />
            Mandatory tasks can block logout here
          </label>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={invalid || act.isPending} onClick={save}>
          {moving ? 'Move node' : editing ? 'Save' : 'Create node'}
        </button>
      </div>
    </Modal>
  )
}
