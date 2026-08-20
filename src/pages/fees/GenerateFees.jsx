import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Calculator, CheckCircle2, ArrowRight } from 'lucide-react'
import { useGet } from '../../api/hooks'
import { api } from '../../api/client'
import { Spinner, Empty, Badge } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']

export default function GenerateFees() {
  const { user, activeSessionId } = useStore()
  const qc = useQueryClient()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: classes = [], isLoading } = useGet('/classes')
  const startMonthDefault = (session?.startDate || '2026-06').slice(0, 7)
  const [sel, setSel] = useState([])
  const [start, setStart] = useState(startMonthDefault)
  const [end, setEnd] = useState(startMonthDefault)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  if (isLoading) return <Spinner />
  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id && c.active !== false)
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])

  async function calculate() {
    setBusy(true); setPreview(null)
    try { setPreview(await api.post('/fee-generation/preview', { sessionId: session.id, classIds: sel, startMonth: start, endMonth: end })) }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  async function generate() {
    setBusy(true)
    try {
      const r = await api.post('/fee-generation/commit', { sessionId: session.id, classIds: sel, startMonth: start, endMonth: end })
      toast.success(`Created ${r.created} fee cycle${r.created === 1 ? '' : 's'} (${r.skipped} skipped)`)
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/fee-cycles') })
      setPreview(null)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-head"><h1>Generate fees</h1><Badge color="orange">{session?.name || '—'}</Badge></div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Generates estimated fee cycles from each student's effective structure (concessions, corporate & group charges applied). Existing cycles are never duplicated.</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3>Classes</h3></div>
        {sessionClasses.length === 0 ? <span className="muted">No classes in this session.</span> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sessionClasses.map((c) => (
              <button key={c.id} type="button" onClick={() => toggle(c.id)} className={`badge ${sel.includes(c.id) ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>
                {sel.includes(c.id) ? '✓ ' : ''}{c.name}
              </button>
            ))}
          </div>
        )}
        <div className="form-row" style={{ marginTop: 14, maxWidth: 460 }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Start month</label><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>End month</label><input type="month" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn" disabled={!sel.length || busy} onClick={calculate}><Calculator size={15} /> Calculate fees</button>
        </div>
      </div>

      {preview && (
        <div className="card">
          <div className="card-title"><h3>Preview</h3></div>
          <div style={{ background: 'var(--sky-soft)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            Will create <b>{preview.willCreate}</b> fee cycle{preview.willCreate === 1 ? '' : 's'} for <b>{preview.studentsWithNew}</b> of {preview.students} students across {preview.months} month{preview.months === 1 ? '' : 's'}; <b>{preview.duplicates}</b> duplicate{preview.duplicates === 1 ? '' : 's'} skipped.
          </div>
          {preview.willCreate === 0 ? <Empty emoji="✅" text="Nothing new to generate — all cycles already exist." /> : (
            <>
              <div className="table-wrap" style={{ boxShadow: 'none', maxHeight: 280, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Student</th><th>New cycles</th><th>Skipped</th></tr></thead>
                  <tbody>
                    {preview.perStudent.filter((p) => p.create > 0 || p.skip > 0).map((p) => (
                      <tr key={p.studentId}><td><b>{p.name}</b></td><td>{p.create}</td><td className="muted">{p.skip}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canManage && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="btn" disabled={busy} onClick={generate}><CheckCircle2 size={15} /> Generate {preview.willCreate} cycle{preview.willCreate === 1 ? '' : 's'}</button>
                </div>
              )}
            </>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>Generated cycles are <b>estimated</b> — approve them in <ArrowRight size={12} /> Approval Requests to raise invoices.</div>
        </div>
      )}
    </div>
  )
}
