import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Upload, PartyPopper } from 'lucide-react'
import toast from 'react-hot-toast'
import { useGet, useAct, fmtDate, fmtDateTime, fmtMoney } from '../../api/hooks'
import { api } from '../../api/client'
import { Badge, Field, Modal, Spinner } from '../../components/ui'

const DOC_TYPES = ['birth_certificate', 'photograph', 'address_proof', 'immunization', 'previous_records']

function ConfirmModal({ app, onClose }) {
  const navigate = useNavigate()
  const { data: classes = [] } = useGet(`/classes?programId=${app.programId}`)
  const classIds = classes.map((c) => c.id)
  const { data: allSections = [] } = useGet('/sections')
  const { data: structures = [] } = useGet(`/fee-structures?programId=${app.programId}`)
  const sections = allSections.filter((s) => classIds.includes(s.classId))
  const [sectionId, setSectionId] = useState('')
  const [feeStructureId, setFeeStructureId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function confirm() {
    setBusy(true)
    try {
      const res = await api.post(`/applications/${app.id}/confirm`, { sectionId, feeStructureId })
      setResult(res)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal title="Admission confirmed 🎉" onClose={() => navigate('/admissions')}>
        <p style={{ marginBottom: 12 }}>
          <b>{result.student.firstName} {result.student.lastName}</b> is now enrolled.
          First invoice <b>{result.invoice.number}</b> for <b>{fmtMoney(result.invoice.total)}</b> has been raised.
        </p>
        {result.createdLogins.length > 0 && (
          <div className="card" style={{ marginBottom: 12, background: 'var(--teal-soft)', border: 'none' }}>
            <b>Parent app logins created:</b>
            {result.createdLogins.map((l) => (
              <div key={l.email} style={{ fontSize: 13, marginTop: 4 }}>
                {l.email} — temp password <code>{l.tempPassword}</code>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link className="btn ghost" to="/admissions">Back to list</Link>
          <Link className="btn" to={`/students/${result.student.id}`}>Open student record</Link>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Confirm admission — ${app.childName}`} onClose={onClose}>
      <Field label="Section">
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Choose section…</option>
          {sections.map((s) => {
            const cls = classes.find((c) => c.id === s.classId)
            return <option key={s.id} value={s.id}>{cls?.name} — {s.name} (cap {s.capacity})</option>
          })}
        </select>
      </Field>
      <Field label="Fee structure">
        <select value={feeStructureId} onChange={(e) => setFeeStructureId(e.target.value)}>
          <option value="">Choose fee plan…</option>
          {structures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Field>
      <p className="muted" style={{ marginBottom: 14 }}>
        Confirming creates the student record, guardian app logins, enrolment, media consents and the first invoice
        (one-time fees + pro-rata month) in one step.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn teal" disabled={!sectionId || !feeStructureId || busy} onClick={confirm}>
          <PartyPopper size={15} /> {busy ? 'Confirming…' : 'Confirm admission'}
        </button>
      </div>
    </Modal>
  )
}

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: app, isLoading } = useGet(`/applications/${id}`)
  const { data: docs = [] } = useGet(`/applications/${id}/documents`)
  const { data: programs = [] } = useGet('/programs')
  const act = useAct(['/applications', `/applications/${id}`])
  const [confirming, setConfirming] = useState(false)

  if (isLoading || !app) return <Spinner />
  const progName = programs.find((p) => p.id === app.programId)?.name || '—'
  const open = !['confirmed', 'rejected'].includes(app.status)
  const docByType = Object.fromEntries(docs.map((d) => [d.type, d]))

  async function uploadDoc(type, file) {
    const fd = new FormData()
    fd.append('file', file)
    const asset = await api.upload('/media', fd)
    const existing = docByType[type]
    if (existing) {
      act.mutate({ method: 'put', path: `/application-documents/${existing.id}`, body: { mediaId: asset.id, status: 'received' }, success: 'Document uploaded' })
    } else {
      act.mutate({ path: `/applications/${id}/documents`, body: { type, mediaId: asset.id, status: 'received' }, success: 'Document uploaded' })
    }
  }

  return (
    <div>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/admissions')}><ArrowLeft size={16} /></button>
        <h1>{app.childName}</h1>
        <Badge status={app.status} />
        <div className="spacer" />
        {open && (
          <>
            <button className="btn ghost" onClick={() => act.mutate({ path: `/applications/${id}/status`, body: { status: 'waitlisted', note: 'Moved to waitlist' } })}>Waitlist</button>
            <button className="btn ghost" onClick={() => act.mutate({ path: `/applications/${id}/status`, body: { status: 'offered', note: 'Offer extended' } })}>Make offer</button>
            <button className="btn danger" onClick={() => act.mutate({ path: `/applications/${id}/status`, body: { status: 'rejected', note: 'Not proceeding' } })}>Reject</button>
            <button className="btn teal" onClick={() => setConfirming(true)}>Confirm admission</button>
          </>
        )}
        {app.status === 'confirmed' && app.studentId && (
          <Link className="btn" to={`/students/${app.studentId}`}>Open student record</Link>
        )}
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title"><h3>Application</h3></div>
          <table style={{ fontSize: 13.5 }}>
            <tbody>
              <tr><td className="muted">Program</td><td><b>{progName}</b></td></tr>
              <tr><td className="muted">Child DOB</td><td>{fmtDate(app.childDob)}</td></tr>
              <tr><td className="muted">Gender</td><td style={{ textTransform: 'capitalize' }}>{app.gender || '—'}</td></tr>
              {(app.guardiansDraft || []).map((g, i) => (
                <tr key={i}>
                  <td className="muted" style={{ textTransform: 'capitalize' }}>{g.relationship || 'Guardian'}</td>
                  <td>{g.name} · {g.phone} {g.email && <span className="muted">· {g.email}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ margin: '18px 0 8px' }}>Decision history</h3>
          <div className="timeline">
            {[...(app.decisions || [])].reverse().map((d, i) => (
              <div className="timeline-item" key={i}>
                <Badge status={d.status} /> {d.note}
                <div className="muted">{fmtDateTime(d.at)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title"><h3>Document checklist</h3></div>
          {DOC_TYPES.map((type) => {
            const doc = docByType[type]
            return (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f4efe6' }}>
                <span style={{ flex: 1, textTransform: 'capitalize', fontWeight: 700, fontSize: 13.5 }}>{type.replace(/_/g, ' ')}</span>
                <Badge status={doc?.status || 'pending'} />
                {open && (
                  <>
                    <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                      <Upload size={13} /> Upload
                      <input type="file" hidden onChange={(e) => e.target.files[0] && uploadDoc(type, e.target.files[0])} />
                    </label>
                    {doc && doc.status !== 'verified' && (
                      <button className="btn sm subtle" onClick={() => act.mutate({ method: 'put', path: `/application-documents/${doc.id}`, body: { status: 'verified' } })}>
                        Verify
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {confirming && <ConfirmModal app={app} onClose={() => setConfirming(false)} />}
    </div>
  )
}
