import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useGet, useAct, fmtMoney, fmtDate, initials } from '../../api/hooks'
import { Badge, Field, Modal, Spinner } from '../../components/ui'

function AddGuardian({ studentId, onClose }) {
  const act = useAct([`/students/${studentId}/full`])
  const [form, setForm] = useState({ name: '', relationship: 'guardian', phone: '', email: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title="Add guardian" onClose={onClose}>
      <div className="form-row">
        <Field label="Name"><input value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Relationship">
          <select value={form.relationship} onChange={set('relationship')}>
            <option>mother</option><option>father</option><option>guardian</option><option>grandparent</option>
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Phone"><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email (app login)"><input type="email" value={form.email} onChange={set('email')} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn" disabled={!form.name}
          onClick={() => act.mutate({ path: `/students/${studentId}/guardians`, body: form, success: 'Guardian linked (login: password)' }, { onSuccess: onClose })}
        >
          Add guardian
        </button>
      </div>
    </Modal>
  )
}

export default function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: s, isLoading } = useGet(`/students/${id}/full`)
  const act = useAct([`/students/${id}/full`, '/students'])
  const [tab, setTab] = useState('profile')
  const [addingGuardian, setAddingGuardian] = useState(false)
  const [medical, setMedical] = useState(null)

  if (isLoading || !s) return <Spinner />
  const balance = s.ledger.at(-1)?.balanceAfter || 0

  return (
    <div>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/students')}><ArrowLeft size={16} /></button>
        <span className="avatar" style={{ width: 42, height: 42, fontSize: 16 }}>{initials(`${s.firstName} ${s.lastName}`)}</span>
        <div>
          <h1>{s.firstName} {s.lastName}</h1>
          <div className="muted">{s.className} — {s.sectionName} · Roll {s.rollNo} · {s.family?.name}</div>
        </div>
        <Badge status={s.status} />
        <div className="spacer" />
        <select
          value={s.status}
          onChange={(e) => act.mutate({ method: 'put', path: `/students/${id}`, body: { status: e.target.value }, success: 'Status updated' })}
          style={{ padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }}
        >
          <option value="active">Active</option>
          <option value="on_leave">On leave</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="alumni">Alumni</option>
        </select>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="stat-label">Attendance this month</div><div className="stat-value">{s.attendance.pct ?? '—'}{s.attendance.pct != null && '%'}</div></div>
        <div className="stat"><div className="stat-label">Fee balance</div><div className="stat-value" style={{ color: balance > 0 ? 'var(--berry)' : 'var(--teal)' }}>{fmtMoney(balance)}</div></div>
        <div className="stat"><div className="stat-label">Guardians</div><div className="stat-value">{s.guardians.length}</div></div>
      </div>

      <div className="tabs">
        {['profile', 'guardians', 'attendance', 'fees'].map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="card">
          <table style={{ fontSize: 13.5 }}>
            <tbody>
              <tr><td className="muted" style={{ width: 160 }}>Date of birth</td><td>{fmtDate(s.dob)}</td></tr>
              <tr><td className="muted">Gender</td><td style={{ textTransform: 'capitalize' }}>{s.gender || '—'}</td></tr>
              <tr><td className="muted">Blood group</td><td>{s.bloodGroup || '—'}</td></tr>
              <tr><td className="muted">Emergency contacts</td><td>{(s.emergencyContacts || []).map((c) => `${c.name} (${c.phone})`).join(', ') || '—'}</td></tr>
              <tr><td className="muted">Authorised pickups</td><td>{(s.authorisedPickups || []).map((p) => `${p.name} (${p.relation})`).join(', ') || '—'}</td></tr>
            </tbody>
          </table>
          <h3 style={{ margin: '16px 0 8px' }}>Medical</h3>
          {medical === null ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span>{s.allergies ? <Badge color="red">Allergies: {s.allergies}</Badge> : <span className="muted">No allergies recorded.</span>}</span>
              <span className="muted">{s.medicalNotes}</span>
              <button className="btn sm ghost" onClick={() => setMedical({ allergies: s.allergies, medicalNotes: s.medicalNotes })}>Edit</button>
            </div>
          ) : (
            <div>
              <div className="form-row">
                <Field label="Allergies"><input value={medical.allergies} onChange={(e) => setMedical({ ...medical, allergies: e.target.value })} /></Field>
                <Field label="Medical notes"><input value={medical.medicalNotes} onChange={(e) => setMedical({ ...medical, medicalNotes: e.target.value })} /></Field>
              </div>
              <button className="btn sm" onClick={() => act.mutate({ method: 'put', path: `/students/${id}`, body: medical, success: 'Medical info saved' }, { onSuccess: () => setMedical(null) })}>Save</button>
            </div>
          )}
        </div>
      )}

      {tab === 'guardians' && (
        <div className="card">
          <div className="card-title">
            <h3>Guardians & app logins</h3>
            <button className="btn sm" onClick={() => setAddingGuardian(true)}><Plus size={13} /> Add guardian</button>
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Name</th><th>Relation</th><th>Phone</th><th>App login</th><th>Primary</th></tr></thead>
              <tbody>
                {s.guardians.map((g) => (
                  <tr key={g.id}>
                    <td><b>{g.name}</b></td>
                    <td style={{ textTransform: 'capitalize' }}>{g.relationship}</td>
                    <td>{g.phone}</td>
                    <td>{g.email || '—'}</td>
                    <td>{g.isPrimary ? <Badge color="green">primary</Badge> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="card">
          <div className="card-title"><h3>This month</h3></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {Object.entries(s.attendance.counts).map(([k, v]) => (
              <Badge key={k} status={k}>{k.replace('_', ' ')}: {v}</Badge>
            ))}
          </div>
          <h3 style={{ marginBottom: 8 }}>Leave requests</h3>
          {s.leaveRequests.length === 0 && <div className="muted">No leave requests.</div>}
          {s.leaveRequests.map((lr) => (
            <div key={lr.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f4efe6', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{fmtDate(lr.fromDate)} → {fmtDate(lr.toDate)} · {lr.reason}</span>
              <Badge status={lr.status} />
            </div>
          ))}
        </div>
      )}

      {tab === 'fees' && (
        <div className="card">
          <div className="card-title"><h3>Ledger</h3></div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead>
              <tbody>
                {[...s.ledger].reverse().map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.createdAt)}</td>
                    <td><Badge color={e.type === 'charge' ? 'yellow' : e.type === 'payment' ? 'green' : 'gray'}>{e.type}</Badge></td>
                    <td style={{ color: e.amount < 0 ? 'var(--teal)' : 'inherit' }}>{fmtMoney(e.amount)}</td>
                    <td><b>{fmtMoney(e.balanceAfter)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addingGuardian && <AddGuardian studentId={id} onClose={() => setAddingGuardian(false)} />}
    </div>
  )
}
