import { useState } from 'react'
import { Plus, Pencil, Ban, RotateCcw, Trash2, Percent } from 'lucide-react'
import { useGet, useAct } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal, ConfirmDialog } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']
const PERIODICITIES = [
  ['one_time', 'One-Time'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half_yearly', 'Half-Yearly'], ['annual', 'Annual'],
]
const PERIOD_LABEL = Object.fromEntries(PERIODICITIES.map(([v, l]) => [v, l]))
const PERIOD_COLOR = { one_time: 'plum', monthly: 'orange', quarterly: 'yellow', half_yearly: 'yellow', annual: 'green' }

const emptyForm = () => ({ name: '', periodicity: 'monthly', taxable: false, gstPct: 18, refundable: false })

function HeadModal({ head, branchId, onClose }) {
  const editing = !!head
  const act = useAct(['/fee-heads'])
  const [form, setForm] = useState(head ? { name: head.name, periodicity: head.periodicity, taxable: !!head.taxable, gstPct: head.gstPct || 18, refundable: !!head.refundable } : emptyForm())
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function save() {
    const body = { name: form.name.trim(), periodicity: form.periodicity, taxable: form.taxable, gstPct: form.taxable ? Number(form.gstPct) || 0 : 0, refundable: form.refundable }
    if (editing) act.mutate({ method: 'put', path: `/fee-heads/${head.id}`, body, success: 'Fee head updated' }, { onSuccess: onClose })
    else act.mutate({ path: '/fee-heads', body: { ...body, branchId }, success: 'Fee head created' }, { onSuccess: onClose })
  }

  return (
    <Modal title={editing ? 'Edit fee component' : 'Create fee component'} onClose={onClose}>
      <div className="form-row">
        <Field label="Name *"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Daycare Fees (Monthly)" autoFocus /></Field>
        <Field label="Periodicity *">
          <select value={form.periodicity} onChange={(e) => set('periodicity', e.target.value)}>
            {PERIODICITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '2px 0 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
          <input type="checkbox" checked={form.taxable} onChange={(e) => set('taxable', e.target.checked)} /> Taxable (GST)
        </label>
        {form.taxable && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min="0" max="100" value={form.gstPct} onChange={(e) => set('gstPct', e.target.value)} style={{ width: 70 }} /><Percent size={13} />
          </span>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
          <input type="checkbox" checked={form.refundable} onChange={(e) => set('refundable', e.target.checked)} /> Refundable (deposit)
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.name.trim() || act.isPending} onClick={save}>{editing ? 'Save' : 'Create'}</button>
      </div>
    </Modal>
  )
}

export default function FeeHeads() {
  const { user, activeSessionId } = useStore()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const branchId = (sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active))?.branchId || ''
  const [showInactive, setShowInactive] = useState(false)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const qs = [branchId && `branchId=${branchId}`, showInactive && 'includeInactive=true'].filter(Boolean).join('&')
  const { data: heads = [], isLoading, isError, error } = useGet(`/fee-heads${qs ? `?${qs}` : ''}`)
  const act = useAct(['/fee-heads'])

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load fee heads'} /></div>

  const filtered = heads.filter((h) => !q || `${h.name} ${h.code}`.toLowerCase().includes(q.toLowerCase()))

  function toggleActive(h) {
    act.mutate({ method: 'put', path: `/fee-heads/${h.id}`, body: { active: h.active === false }, success: h.active === false ? 'Reactivated' : 'Deactivated' }, { onSuccess: () => setConfirm(null) })
  }
  function del(h) {
    act.mutate({ method: 'del', path: `/fee-heads/${h.id}`, success: 'Fee head deleted' }, { onSuccess: () => setConfirm(null) })
  }

  return (
    <div>
      <div className="page-head">
        <h1>Fee components</h1>
        <div className="spacer" />
        <div className="filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search components…" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        </div>
        {canManage && <button className="btn" onClick={() => setModal({})}><Plus size={15} /> Create component</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="card"><Empty emoji="🏷️" text="No fee components found" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {filtered.map((h) => {
            const used = (h.usage?.total || 0) > 0
            const inactive = h.active === false
            return (
              <div key={h.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: inactive ? 0.7 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15.5 }}>{h.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{h.code}</div>
                  </div>
                  <Badge color={PERIOD_COLOR[h.periodicity] || 'gray'}>{PERIOD_LABEL[h.periodicity] || h.periodicity}</Badge>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {h.taxable && <Badge color="yellow">GST {h.gstPct}%</Badge>}
                  {h.refundable && <Badge color="plum">Refundable</Badge>}
                  {inactive && <Badge color="gray">inactive</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {used ? `Used in ${h.usage.structures} structure${h.usage.structures === 1 ? '' : 's'} · ${h.usage.invoices} invoice${h.usage.invoices === 1 ? '' : 's'}` : 'Not used yet'}
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
                    <button className="btn sm ghost" onClick={() => setModal({ head: h })}><Pencil size={13} /> Edit</button>
                    {inactive
                      ? <button className="btn sm subtle" onClick={() => toggleActive(h)}><RotateCcw size={13} /> Activate</button>
                      : <button className="btn sm ghost" onClick={() => setConfirm({ h, mode: 'deactivate' })}><Ban size={13} /> Deactivate</button>}
                    <button className="btn sm ghost" disabled={used} title={used ? 'In use — deactivate instead' : 'Delete'} onClick={() => setConfirm({ h, mode: 'delete' })}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal && <HeadModal head={modal.head} branchId={branchId} onClose={() => setModal(null)} />}
      {confirm && confirm.mode === 'delete' && (
        <ConfirmDialog title={`Delete “${confirm.h.name}”?`} message="Permanently removes this unused fee component." confirmLabel="Delete" busy={act.isPending} onConfirm={() => del(confirm.h)} onClose={() => setConfirm(null)} />
      )}
      {confirm && confirm.mode === 'deactivate' && (
        <ConfirmDialog title={`Deactivate “${confirm.h.name}”?`} message="Hidden from new structures but kept for existing references. Reactivate anytime via “Show inactive”." confirmLabel="Deactivate" tone="default" busy={act.isPending} onConfirm={() => toggleActive(confirm.h)} onClose={() => setConfirm(null)} />
      )}
    </div>
  )
}
