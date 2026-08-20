import { useState } from 'react'
import { Save, Plus, Trash2, Building2, Bell, CalendarClock, AlertTriangle, RefreshCw } from 'lucide-react'
import { useGet, useAct, fmtMoney } from '../../api/hooks'
import { api } from '../../api/client'
import { toPaise, fromPaise } from '../../services/fees/money'
import { CYCLE_LABEL, CYCLES } from '../../services/fees/estimate'
import { Spinner, Empty, Badge, Field } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']
const CHANNELS = [['in_app', 'In-app'], ['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp']]
const RULE_TYPES = [['before', 'Before due'], ['on_due', 'On due date'], ['overdue', 'Every N days overdue']]

export default function FeeSettings() {
  const { activeSessionId } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data, isLoading, isError, error } = useGet(session ? `/fee-settings?sessionId=${session.id}${session.branchId ? `&branchId=${session.branchId}` : ''}` : '/health')
  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load settings'} /></div>
  if (!session) return <div className="card"><Empty emoji="⚙️" text="No active session" /></div>
  return <SettingsForm key={session.id} session={session} initial={data} />
}

function SettingsForm({ session, initial }) {
  const { user } = useStore()
  const canManage = MANAGE.includes(user.role)
  const act = useAct(['/fee-settings'])
  const [f, setF] = useState(() => ({
    lateFee: { type: 'fixed', amount: 0, cap: 0, grace: 0, ...initial.lateFee },
    perCycleDueDay: { ...initial.perCycleDueDay },
    autoGenerate: { enabled: false, dayOfMonth: 1, ...initial.autoGenerate },
    autoReminders: { enabled: false, channels: [], rules: [], ...initial.autoReminders },
    bankAccounts: (initial.bankAccounts || []).map((b) => ({ ...b })),
    reportEmailsText: (initial.reportEmails || []).join(', '),
  }))
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  const setLate = (k, v) => setF((s) => ({ ...s, lateFee: { ...s.lateFee, [k]: v } }))
  const setGen = (k, v) => setF((s) => ({ ...s, autoGenerate: { ...s.autoGenerate, [k]: v } }))
  const setRem = (k, v) => setF((s) => ({ ...s, autoReminders: { ...s.autoReminders, [k]: v } }))

  async function recalc(lateFee = f.lateFee) {
    setPreviewing(true)
    try {
      const res = await api.post('/fee-settings/preview', { academicYearId: session.id, branchId: session.branchId, lateFee })
      setPreview(res)
    } catch { /* ignore */ } finally { setPreviewing(false) }
  }

  function toggleChannel(c) {
    const has = f.autoReminders.channels.includes(c)
    setRem('channels', has ? f.autoReminders.channels.filter((x) => x !== c) : [...f.autoReminders.channels, c])
  }
  const addRule = () => setRem('rules', [...f.autoReminders.rules, { type: 'before', days: 3 }])
  const setRule = (i, k, v) => setRem('rules', f.autoReminders.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const addBank = () => setF((s) => ({ ...s, bankAccounts: [...s.bankAccounts, { name: '', accountNo: '', ifsc: '', upi: '' }] }))
  const setBank = (i, k, v) => setF((s) => ({ ...s, bankAccounts: s.bankAccounts.map((b, j) => (j === i ? { ...b, [k]: v } : b)) }))

  function save() {
    const body = {
      academicYearId: session.id, branchId: session.branchId,
      lateFee: f.lateFee, perCycleDueDay: f.perCycleDueDay, autoGenerate: f.autoGenerate, autoReminders: f.autoReminders,
      bankAccounts: f.bankAccounts.filter((b) => b.name || b.accountNo),
      reportEmails: f.reportEmailsText.split(',').map((e) => e.trim()).filter(Boolean),
    }
    act.mutate({ method: 'put', path: '/fee-settings', body, success: 'Fee settings saved' })
  }

  const isPct = f.lateFee.type === 'percentage'

  return (
    <div>
      <div className="page-head">
        <h1>Fee settings</h1>
        <Badge color="orange">{session.name}</Badge>
        <div className="spacer" />
        {canManage && <button className="btn" disabled={act.isPending} onClick={save}><Save size={15} /> Save settings</button>}
      </div>

      {/* Due dates & late fees */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3><CalendarClock size={15} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />Due dates & late fees</h3></div>
        <div className="form-row-3">
          <Field label="Late fee type">
            <select value={f.lateFee.type} disabled={!canManage} onChange={(e) => setLate('type', e.target.value)}>
              <option value="fixed">Fixed (₹)</option>
              <option value="percentage">Percentage (%)</option>
            </select>
          </Field>
          <Field label={isPct ? 'Late fee (%)' : 'Late fee (₹)'}>
            <input type="number" min="0" disabled={!canManage}
              value={isPct ? f.lateFee.amount : fromPaise(f.lateFee.amount)}
              onChange={(e) => setLate('amount', isPct ? Number(e.target.value) : toPaise(e.target.value))} />
          </Field>
          <Field label="Cap (₹, 0 = none)">
            <input type="number" min="0" disabled={!canManage} value={fromPaise(f.lateFee.cap)} onChange={(e) => setLate('cap', toPaise(e.target.value))} />
          </Field>
        </div>
        <Field label="Grace period (days after due date before late fee applies)">
          <input type="number" min="0" style={{ width: 120 }} disabled={!canManage} value={f.lateFee.grace} onChange={(e) => setLate('grace', Number(e.target.value))} />
        </Field>

        <label style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)' }}>Due day per cycle</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          {CYCLES.map((c) => (
            <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="muted" style={{ fontSize: 11 }}>{CYCLE_LABEL[c]}</span>
              <input type="number" min="1" max="28" style={{ width: 70 }} disabled={!canManage}
                value={f.perCycleDueDay[c] ?? ''} onChange={(e) => setF((s) => ({ ...s, perCycleDueDay: { ...s.perCycleDueDay, [c]: Number(e.target.value) } }))} />
            </div>
          ))}
        </div>

        {/* preview effect */}
        <div style={{ background: 'var(--sun-soft)', borderRadius: 10, padding: 12, marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: '#ad7a12' }} />
          <div style={{ flex: 1, fontSize: 13 }}>
            {preview
              ? preview.affected === 0
                ? `No late fee would apply right now (${preview.overdueCount} overdue invoice${preview.overdueCount === 1 ? '' : 's'}, all within grace).`
                : <>A late fee of <b>{fmtMoney(preview.totalLateFee)}</b> would apply across <b>{preview.affected}</b> of {preview.overdueCount} overdue invoice{preview.overdueCount === 1 ? '' : 's'}.</>
              : 'Preview how this late-fee rule affects current overdue invoices.'}
          </div>
          <button className="btn sm ghost" disabled={previewing} onClick={() => recalc()}><RefreshCw size={13} /> {previewing ? 'Calculating…' : 'Preview effect'}</button>
        </div>
      </div>

      {/* Automatic generation */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3>Automatic fee generation</h3></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" disabled={!canManage} checked={f.autoGenerate.enabled} onChange={(e) => setGen('enabled', e.target.checked)} />
          Auto-generate the monthly cycle
        </label>
        {f.autoGenerate.enabled && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            Generate on day
            <input type="number" min="1" max="28" style={{ width: 70 }} disabled={!canManage} value={f.autoGenerate.dayOfMonth} onChange={(e) => setGen('dayOfMonth', Number(e.target.value))} />
            of each month.
          </div>
        )}
      </div>

      {/* Automatic reminders */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3><Bell size={15} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />Automatic reminders</h3></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" disabled={!canManage} checked={f.autoReminders.enabled} onChange={(e) => setRem('enabled', e.target.checked)} /> Send automatic fee reminders
        </label>
        {f.autoReminders.enabled && (
          <>
            <div style={{ margin: '12px 0 6px' }}>
              <span className="muted" style={{ fontSize: 12, fontWeight: 800 }}>Channels</span>
              <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {CHANNELS.map(([v, l]) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" disabled={!canManage} checked={f.autoReminders.channels.includes(v)} onChange={() => toggleChannel(v)} /> {l}
                  </label>
                ))}
              </div>
            </div>
            <span className="muted" style={{ fontSize: 12, fontWeight: 800 }}>Rules</span>
            {f.autoReminders.rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <select value={r.type} disabled={!canManage} onChange={(e) => setRule(i, 'type', e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 9 }}>
                  {RULE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {r.type !== 'on_due' && <input type="number" min="0" style={{ width: 80 }} disabled={!canManage} value={r.days} onChange={(e) => setRule(i, 'days', Number(e.target.value))} />}
                <span className="muted" style={{ fontSize: 12 }}>{r.type === 'before' ? 'days before' : r.type === 'overdue' ? 'days interval' : ''}</span>
                {canManage && <button className="icon-btn" onClick={() => setRem('rules', f.autoReminders.rules.filter((_, j) => j !== i))}><Trash2 size={13} /></button>}
              </div>
            ))}
            {canManage && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={addRule}><Plus size={13} /> Add rule</button>}
          </>
        )}
      </div>

      {/* Bank accounts */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <h3><Building2 size={15} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />Bank accounts (shown on invoices for NEFT)</h3>
          {canManage && <button className="btn sm ghost" onClick={addBank}><Plus size={13} /> Add account</button>}
        </div>
        {f.bankAccounts.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>No bank accounts yet.</span> : f.bankAccounts.map((b, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.2fr 1.5fr auto', gap: 8, marginBottom: 8 }}>
            <input placeholder="Account name" disabled={!canManage} value={b.name} onChange={(e) => setBank(i, 'name', e.target.value)} />
            <input placeholder="Account no." disabled={!canManage} value={b.accountNo} onChange={(e) => setBank(i, 'accountNo', e.target.value)} />
            <input placeholder="IFSC" disabled={!canManage} value={b.ifsc} onChange={(e) => setBank(i, 'ifsc', e.target.value)} />
            <input placeholder="UPI ID" disabled={!canManage} value={b.upi} onChange={(e) => setBank(i, 'upi', e.target.value)} />
            {canManage && <button className="icon-btn" onClick={() => setF((s) => ({ ...s, bankAccounts: s.bankAccounts.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      {/* Report emails */}
      <div className="card">
        <div className="card-title"><h3>Fee report emails</h3></div>
        <Field label="Comma-separated recipients for scheduled fee summaries">
          <input disabled={!canManage} value={f.reportEmailsText} onChange={(e) => setF((s) => ({ ...s, reportEmailsText: e.target.value }))} placeholder="principal@kidzonia.com, accounts@kidzonia.com" />
        </Field>
      </div>
    </div>
  )
}
