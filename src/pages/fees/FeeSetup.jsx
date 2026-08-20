import { useState } from 'react'
import { Plus, Trash2, Pencil, Copy, Wallet } from 'lucide-react'
import { useGet, useAct, fmtMoney } from '../../api/hooks'
import { toPaise, fromPaise } from '../../services/fees/money'
import { annualise, CYCLE_LABEL, CYCLES } from '../../services/fees/estimate'
import { Field, Modal, Spinner, Badge, Empty } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']

function EstimatePanel({ lines }) {
  const est = annualise(lines.filter((l) => l.feeHeadId))
  return (
    <div style={{ background: 'var(--marmalade-soft)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--marmalade-deep)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Estimate — annual per student</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{fmtMoney(est.annualTotal)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {est.cycles.map((c) => (
          <Badge key={c.cycle} color="gray">{CYCLE_LABEL[c.cycle]}: {fmtMoney(c.perInstallment)} × {c.installments} = {fmtMoney(c.annual)}</Badge>
        ))}
        {est.cycles.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Add lines to preview.</span>}
      </div>
    </div>
  )
}

function BuilderModal({ structure, classId, classes, heads, sessionId, sessionName, onClose }) {
  const act = useAct(['/fee-structures'])
  const [cid, setCid] = useState(classId || structure?.classId || classes[0]?.id || '')
  const [lines, setLines] = useState(() => (structure?.lines || []).map((l) => ({ ...l })))
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const addLine = () => {
    const used = new Set(lines.map((l) => l.feeHeadId))
    const h = heads.find((x) => !used.has(x.id)) || heads[0]
    setLines([...lines, { feeHeadId: h?.id || '', amount: 0, cycle: h?.periodicity || 'monthly' }])
  }

  function save() {
    act.mutate({
      method: 'put', path: '/class-fees/structure',
      body: { sessionId, classId: cid, lines: lines.filter((l) => l.feeHeadId).map((l) => ({ feeHeadId: l.feeHeadId, amount: l.amount, cycle: l.cycle })) },
      success: 'Fee structure saved',
    }, { onSuccess: onClose })
  }

  return (
    <Modal title={structure ? 'Edit fee structure' : 'Build fee structure'} onClose={onClose} wide>
      <div className="form-row">
        <Field label="Class">
          <select value={cid} onChange={(e) => setCid(e.target.value)} disabled={!!structure}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Session"><input value={sessionName} disabled /></Field>
      </div>

      <label style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)' }}>Fee lines</label>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <select value={l.feeHeadId} onChange={(e) => setLine(i, 'feeHeadId', e.target.value)} style={{ flex: 2, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 9 }}>
            <option value="">— fee head —</option>
            {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <input type="number" min="0" placeholder="₹" value={fromPaise(l.amount)} onChange={(e) => setLine(i, 'amount', toPaise(e.target.value))} style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
          <select value={l.cycle} onChange={(e) => setLine(i, 'cycle', e.target.value)} style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 9 }}>
            {CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
          </select>
          <button className="icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="btn sm ghost" style={{ margin: '10px 0 14px' }} onClick={addLine}><Plus size={13} /> Add line</button>

      <EstimatePanel lines={lines} />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!cid || !lines.some((l) => l.feeHeadId) || act.isPending} onClick={save}>Save structure</button>
      </div>
    </Modal>
  )
}

function CloneModal({ structure, classes, sessions, onClose }) {
  const act = useAct(['/fee-structures'])
  const [toClassId, setToClassId] = useState('')
  const [toSessionId, setToSessionId] = useState(structure.academicYearId)
  const targetClasses = classes.filter((c) => c.academicYearId === toSessionId)
  return (
    <Modal title={`Clone “${structure.name}”`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Copies all fee lines into another class / session. Fails if the target already has a structure.</p>
      <div className="form-row">
        <Field label="To session">
          <select value={toSessionId} onChange={(e) => { setToSessionId(e.target.value); setToClassId('') }}>
            {sessions.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
          </select>
        </Field>
        <Field label="To class">
          <select value={toClassId} onChange={(e) => setToClassId(e.target.value)}>
            <option value="">— select —</option>
            {targetClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!toClassId || act.isPending} onClick={() => act.mutate({ path: '/class-fees/structure/clone', body: { sourceId: structure.id, toClassId, toSessionId }, success: 'Structure cloned' }, { onSuccess: onClose })}>Clone</button>
      </div>
    </Modal>
  )
}

export default function FeeSetup() {
  const { user, activeSessionId } = useStore()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const branchId = session?.branchId
  const { data: structures = [], isLoading } = useGet(session ? `/fee-structures?academicYearId=${session.id}${branchId ? `&branchId=${branchId}` : ''}` : '/health')
  const { data: classes = [] } = useGet('/classes')
  const { data: heads = [] } = useGet(branchId ? `/fee-heads?branchId=${branchId}` : '/fee-heads')
  const [builder, setBuilder] = useState(null) // { structure?, classId? }
  const [clone, setClone] = useState(null)

  if (isLoading) return <Spinner />
  const headName = (id) => heads.find((h) => h.id === id)?.name || '—'
  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id && c.active !== false)
  const structuredClassIds = new Set(structures.map((s) => s.classId))
  const classesWithout = sessionClasses.filter((c) => !structuredClassIds.has(c.id))

  return (
    <div>
      <div className="page-head">
        <h1>Fee structures</h1>
        <Badge color="orange">{session?.name || '—'}</Badge>
        <div className="spacer" />
        {canManage && <button className="btn" onClick={() => setBuilder({})}><Plus size={15} /> Build structure</button>}
      </div>

      {structures.length === 0 ? (
        <div className="card"><Empty emoji="🧾" text={`No fee structures for ${session?.name || 'this session'} yet`} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {structures.map((f) => {
            const est = annualise(f.lines)
            return (
              <div className="card" key={f.id}>
                <div className="card-title">
                  <h3><Wallet size={15} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />{f.name}</h3>
                  <Badge color="green">{fmtMoney(est.annualTotal)}/yr</Badge>
                </div>
                <table style={{ fontSize: 13.5, width: '100%' }}>
                  <tbody>
                    {f.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{headName(l.feeHeadId)}</td>
                        <td className="muted">{CYCLE_LABEL[l.cycle] || l.cycle}</td>
                        <td style={{ textAlign: 'right' }}><b>{fmtMoney(l.amount)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn sm ghost" onClick={() => setBuilder({ structure: f })}><Pencil size={13} /> Edit</button>
                    <button className="btn sm ghost" onClick={() => setClone(f)}><Copy size={13} /> Clone</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {builder && (
        <BuilderModal
          structure={builder.structure}
          classId={builder.classId}
          classes={builder.structure ? sessionClasses : classesWithout}
          heads={heads}
          sessionId={session.id}
          sessionName={session.name}
          onClose={() => setBuilder(null)}
        />
      )}
      {clone && <CloneModal structure={clone} classes={classes} sessions={sessions} onClose={() => setClone(null)} />}
    </div>
  )
}
