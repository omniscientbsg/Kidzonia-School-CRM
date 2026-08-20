import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Percent, IndianRupee } from 'lucide-react'
import { useGet, useAct, fmtMoney } from '../../api/hooks'
import { api } from '../../api/client'
import { toPaise, fromPaise } from '../../services/fees/money'
import { Spinner, Empty, Badge, Field, Modal, ConfirmDialog } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']
const CATEGORIES = ['EWS', 'OBC', 'SC', 'ST', 'Staff-ward', 'Sibling', 'Scholarship', 'Custom']

// per-head value editor shared by concession + corporate rules
function ValueGrid({ heads, type, values, onChange }) {
  const isPct = type === 'percentage'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
      {heads.map((h) => {
        const raw = values[h.id]
        return (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 13 }}>{h.name}</span>
            <input type="number" min="0" style={{ width: 80 }} placeholder={isPct ? '%' : '₹'}
              value={raw == null ? '' : isPct ? raw : fromPaise(raw)}
              onChange={(e) => {
                const v = e.target.value
                const next = { ...values }
                if (v === '') delete next[h.id]
                else next[h.id] = isPct ? Number(v) : toPaise(v)
                onChange(next)
              }} />
            {isPct ? <Percent size={12} style={{ opacity: 0.5 }} /> : <IndianRupee size={12} style={{ opacity: 0.5 }} />}
          </div>
        )
      })}
    </div>
  )
}

function SamplePreview({ sessionId, students, draft }) {
  const [studentId, setStudentId] = useState('')
  const [res, setRes] = useState(null)
  async function run(id) {
    setStudentId(id)
    if (!id) return setRes(null)
    try { setRes(await api.post('/concessions/preview', { studentId: id, sessionId, concession: draft })) }
    catch (e) { toast.error(e.message) }
  }
  return (
    <div style={{ background: 'var(--sky-soft)', borderRadius: 10, padding: 12, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Net effect on a sample student</div>
      <select value={studentId} onChange={(e) => run(e.target.value)} style={{ marginBottom: 8 }}>
        <option value="">Pick a student…</option>
        {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
      </select>
      {res && (
        <div style={{ fontSize: 13 }}>
          <b>{res.studentName}</b>: gross {fmtMoney(res.totals.annualGross)}/yr → <b style={{ color: 'var(--teal)' }}>net {fmtMoney(res.totals.annualNet)}/yr</b> (saves {fmtMoney(res.totals.annualGross - res.totals.annualNet)})
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {res.lines.filter((l) => l.concession > 0).map((l) => <Badge key={l.feeHeadId} color="green">{l.name} −{fmtMoney(l.concession)}</Badge>)}
          </div>
        </div>
      )}
    </div>
  )
}

function RuleModal({ mode, rule, heads, students, sessionId, branchId, onClose }) {
  const isConc = mode === 'concession'
  const act = useAct([isConc ? '/concessions' : '/corporates'])
  const [form, setForm] = useState(() => ({
    category: rule?.category || 'EWS',
    name: rule?.name || (isConc ? '' : ''),
    type: rule?.type || 'percentage',
    values: { ...(rule?.values || {}) },
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const draft = { type: form.type, values: form.values }

  function save() {
    const body = isConc
      ? { academicYearId: sessionId, branchId, category: form.category, name: form.category === 'Custom' ? form.name : form.category, type: form.type, values: form.values }
      : { branchId, name: form.name, type: form.type, values: form.values }
    const path = isConc ? '/concessions' : '/corporates'
    if (rule) act.mutate({ method: 'put', path: `${path}/${rule.id}`, body, success: 'Saved' }, { onSuccess: onClose })
    else act.mutate({ path, body, success: 'Created' }, { onSuccess: onClose })
  }

  return (
    <Modal title={rule ? 'Edit rule' : isConc ? 'New concession' : 'New corporate'} onClose={onClose} wide>
      <div className="form-row">
        {isConc ? (
          <Field label="Category">
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
        ) : (
          <Field label="Company name"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Infosys" autoFocus /></Field>
        )}
        <Field label="Type">
          <select value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="percentage">Percentage (%)</option>
            <option value="fixed">Fixed (₹)</option>
          </select>
        </Field>
      </div>
      {isConc && form.category === 'Custom' && <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Custom concession name" /></Field>}

      <label style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)' }}>Value per fee component</label>
      <div style={{ marginTop: 8 }}><ValueGrid heads={heads} type={form.type} values={form.values} onChange={(v) => set('values', v)} /></div>

      {isConc && <SamplePreview sessionId={sessionId} students={students} draft={draft} />}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={(isConc ? false : !form.name.trim()) || Object.keys(form.values).length === 0 || act.isPending} onClick={save}>Save</button>
      </div>
    </Modal>
  )
}

function RuleList({ mode, rules, heads, students, sessionId, branchId, canManage }) {
  const isConc = mode === 'concession'
  const act = useAct([isConc ? '/concessions' : '/corporates'])
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const headName = (id) => heads.find((h) => h.id === id)?.name || id
  const fmtVal = (r, v) => (r.type === 'percentage' ? `${v}%` : fmtMoney(v))

  return (
    <div>
      {canManage && <div style={{ marginBottom: 12 }}><button className="btn" onClick={() => setModal({})}><Plus size={15} /> {isConc ? 'New concession' : 'New corporate'}</button></div>}
      {rules.length === 0 ? <div className="card"><Empty emoji="🏷️" text={`No ${isConc ? 'concessions' : 'corporates'} yet`} /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {rules.map((r) => (
            <div key={r.id} className="card">
              <div className="card-title">
                <h3>{isConc ? r.category : r.name}{isConc && r.category === 'Custom' && ` · ${r.name}`}</h3>
                <Badge color={r.type === 'percentage' ? 'plum' : 'orange'}>{r.type === 'percentage' ? '%' : '₹'}</Badge>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
                {Object.entries(r.values || {}).map(([hid, v]) => (
                  <div key={hid} style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">{headName(hid)}</span><b>{fmtVal(r, v)}</b></div>
                ))}
              </div>
              {canManage && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button className="btn sm ghost" onClick={() => setModal({ rule: r })}><Pencil size={13} /> Edit</button>
                  <button className="btn sm ghost" onClick={() => setConfirm(r)}><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {modal && <RuleModal mode={mode} rule={modal.rule} heads={heads} students={students} sessionId={sessionId} branchId={branchId} onClose={() => setModal(null)} />}
      {confirm && <ConfirmDialog title={`Delete “${isConc ? confirm.category : confirm.name}”?`} confirmLabel="Delete" busy={act.isPending} onConfirm={() => act.mutate({ method: 'del', path: `${isConc ? '/concessions' : '/corporates'}/${confirm.id}`, success: 'Deleted' }, { onSuccess: () => setConfirm(null) })} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function GroupCharges({ groups, heads, canManage }) {
  const act = useAct(['/groups'])
  const [editing, setEditing] = useState(null)
  const headName = (id) => heads.find((h) => h.id === id)?.name || id
  return (
    <div>
      {groups.length === 0 ? <div className="card"><Empty emoji="👥" text="No groups (create them in Setup → Groups)" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {groups.map((g) => (
            <div key={g.id} className="card">
              <div className="card-title"><h3>{g.name}</h3><Badge color="plum">{g.type}</Badge></div>
              {(g.charges || []).length === 0 ? <span className="muted" style={{ fontSize: 13 }}>No charges/discounts.</span> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
                  {g.charges.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="muted">{headName(c.feeHeadId)}</span>
                      <b style={{ color: c.kind === 'discount' ? 'var(--teal)' : 'var(--berry)' }}>{c.kind === 'discount' ? '−' : '+'}{c.type === 'percentage' ? `${c.value}%` : fmtMoney(c.value)}</b>
                    </div>
                  ))}
                </div>
              )}
              {canManage && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setEditing(g)}><Pencil size={13} /> Edit charges</button>}
            </div>
          ))}
        </div>
      )}
      {editing && <ChargesModal group={editing} heads={heads} act={act} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ChargesModal({ group, heads, act, onClose }) {
  const [charges, setCharges] = useState(() => (group.charges || []).map((c) => ({ ...c })))
  const setC = (i, k, v) => setCharges(charges.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
  const add = () => setCharges([...charges, { feeHeadId: heads[0]?.id || '', kind: 'charge', type: 'fixed', value: 0 }])
  return (
    <Modal title={`Charges — ${group.name}`} onClose={onClose} wide>
      {charges.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <select value={c.feeHeadId} onChange={(e) => setC(i, 'feeHeadId', e.target.value)} style={{ flex: 2, padding: '7px 9px', border: '1.5px solid var(--line)', borderRadius: 9 }}>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          <select value={c.kind} onChange={(e) => setC(i, 'kind', e.target.value)} style={{ padding: '7px 9px', border: '1.5px solid var(--line)', borderRadius: 9 }}><option value="charge">Charge +</option><option value="discount">Discount −</option></select>
          <select value={c.type} onChange={(e) => setC(i, 'type', e.target.value)} style={{ padding: '7px 9px', border: '1.5px solid var(--line)', borderRadius: 9 }}><option value="fixed">₹</option><option value="percentage">%</option></select>
          <input type="number" min="0" style={{ width: 90 }} value={c.type === 'percentage' ? c.value : fromPaise(c.value)} onChange={(e) => setC(i, 'value', c.type === 'percentage' ? Number(e.target.value) : toPaise(e.target.value))} />
          <button className="icon-btn" onClick={() => setCharges(charges.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={add}><Plus size={13} /> Add line</button>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={act.isPending} onClick={() => act.mutate({ method: 'put', path: `/groups/${group.id}/charges`, body: { charges }, success: 'Group charges saved' }, { onSuccess: onClose })}>Save</button>
      </div>
    </Modal>
  )
}

export default function Concessions() {
  const { user, activeSessionId } = useStore()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const branchId = session?.branchId
  const [tab, setTab] = useState('concession')
  const { data: heads = [], isLoading } = useGet(branchId ? `/fee-heads?branchId=${branchId}` : '/fee-heads')
  const { data: concessions = [] } = useGet(session ? `/concessions?sessionId=${session.id}${branchId ? `&branchId=${branchId}` : ''}` : '/health')
  const { data: corporates = [] } = useGet(branchId ? `/corporates?branchId=${branchId}` : '/corporates')
  const { data: students = [] } = useGet('/students')
  const { data: groups = [] } = useGet('/groups')

  if (isLoading) return <Spinner />
  const sessionGroups = groups.filter((g) => g.academicYearId === session?.id || !g.academicYearId)

  return (
    <div>
      <div className="page-head"><h1>Concessions & discounts</h1><Badge color="orange">{session?.name || '—'}</Badge></div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Precedence applied in fee generation: <b>concession → corporate → group</b>. Discounts never reduce a line below ₹0.</div>
      <div className="tabs">
        {[['concession', 'Concessions'], ['corporate', 'Corporate'], ['group', 'Group charges']].map(([v, l]) => (
          <button key={v} className={`tab ${tab === v ? 'active' : ''}`} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>
      {tab === 'concession' && <RuleList mode="concession" rules={concessions} heads={heads} students={students} sessionId={session?.id} branchId={branchId} canManage={canManage} />}
      {tab === 'corporate' && <RuleList mode="corporate" rules={corporates} heads={heads} students={students} sessionId={session?.id} branchId={branchId} canManage={canManage} />}
      {tab === 'group' && <GroupCharges groups={sessionGroups} heads={heads} canManage={canManage} />}
    </div>
  )
}
