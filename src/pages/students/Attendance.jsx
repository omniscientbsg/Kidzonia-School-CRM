import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useGet, todayISO, initials } from '../../api/hooks'
import { api } from '../../api/client'
import { Lock } from 'lucide-react'
import { Spinner, Empty } from '../../components/ui'
import { useQueryClient } from '@tanstack/react-query'

const STATUSES = ['present', 'absent', 'late', 'half_day']

export default function Attendance() {
  const qc = useQueryClient()
  const { data: sections = [] } = useGet('/sections')
  const { data: classes = [] } = useGet('/classes')
  const [sectionId, setSectionId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [marks, setMarks] = useState({})
  const [saving, setSaving] = useState(false)
  // set when a completed task has turned this register into evidence
  const [locked, setLocked] = useState(null)
  const [reEditReason, setReEditReason] = useState('')
  const rosterPath = sectionId ? `/attendance?sectionId=${sectionId}&date=${date}` : null
  const { data: roster = [], isLoading } = useGet(rosterPath || '/attendance?sectionId=none&date=none', { enabled: !!sectionId })

  const sectionName = (s) => `${classes.find((c) => c.id === s.classId)?.name || ''} — ${s.name}`

  useEffect(() => {
    if (!sectionId && sections.length) setSectionId(sections[0].id)
  }, [sections, sectionId])

  useEffect(() => {
    const init = {}
    for (const r of roster) init[r.studentId] = { status: r.status, reason: r.reason || '' }
    setMarks(init)
  }, [roster])

  const summary = useMemo(() => {
    const vals = Object.values(marks).filter((m) => m.status)
    return {
      marked: vals.length,
      absent: vals.filter((m) => m.status === 'absent').length,
      late: vals.filter((m) => m.status === 'late').length,
    }
  }, [marks])

  function setStatus(studentId, status) {
    setMarks((m) => ({ ...m, [studentId]: { ...(m[studentId] || {}), status } }))
  }

  async function save() {
    setSaving(true)
    try {
      const records = Object.entries(marks)
        .filter(([, m]) => m.status && m.status !== 'leave')
        .map(([studentId, m]) => ({ studentId, status: m.status, reason: m.reason || '' }))
      const res = await api.post('/attendance', { sectionId, date, records })
      toast.success(
        res.notified.length
          ? `Saved — ${res.notified.length} guardian${res.notified.length > 1 ? 's' : ''} notified of absence/late`
          : 'Attendance saved'
      )
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/attendance') })
      setLocked(null)
    } catch (err) {
      // 423: a completed task was verified against this register. Not a dead
      // end — the response carries the way to ask for one edit.
      if (err.status === 423 || err.data?.error === 'record_locked') setLocked(err.data || { message: err.message })
      else toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function requestReEdit() {
    try {
      await api.post(`/tasks/locks/${locked.lockId}/request`, { reason: reEditReason })
      toast.success('Sent — everyone above you can approve it')
      setLocked({ ...locked, canRequest: false })
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Attendance</h1>
        <div className="spacer" />
        <div className="filters">
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            className="btn ghost"
            onClick={() => setMarks(Object.fromEntries(roster.map((r) => [r.studentId, { status: r.approvedLeave ? 'leave' : 'present', reason: '' }])))}
          >
            All present
          </button>
          <button className="btn" onClick={save} disabled={saving || !summary.marked}>
            {saving ? 'Saving…' : `Save (${summary.marked})`}
          </button>
        </div>
      </div>

      {locked && (
        <div className="card" style={{ borderLeft: '3px solid var(--berry)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Lock size={16} style={{ color: 'var(--berry)', marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13.5 }}>This register is locked</b>
              <div className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>{locked.message}</div>
              {locked.canRequest ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input style={{ flex: 1, minWidth: 220 }} value={reEditReason} placeholder="Why does it need changing?"
                    onChange={(e) => setReEditReason(e.target.value)} />
                  <button className="btn sm" disabled={!reEditReason.trim()} onClick={requestReEdit}>
                    Request approval to edit
                  </button>
                </div>
              ) : (
                <span className="muted" style={{ fontSize: 12.5 }}>Waiting on approval. You will be notified.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading && <Spinner />}
      {!isLoading && sectionId && (
        <div className="card">
          {roster.length === 0 && <Empty emoji="🧒" text="No students enrolled in this section" />}
          {roster.map((r) => {
            const mark = marks[r.studentId] || {}
            return (
              <div className="att-row" key={r.studentId}>
                <span className="avatar">{initials(r.name)}</span>
                <div>
                  <b>{r.name}</b>
                  <div className="muted">Roll {r.rollNo}{r.approvedLeave ? ' · approved leave' : ''}</div>
                </div>
                {(mark.status === 'late' || mark.status === 'absent') && (
                  <input
                    placeholder="Reason…"
                    value={mark.reason || ''}
                    onChange={(e) => setMarks((m) => ({ ...m, [r.studentId]: { ...mark, reason: e.target.value } }))}
                    style={{ marginLeft: 12, padding: '5px 9px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 12.5, width: 150 }}
                  />
                )}
                <div className="att-opts">
                  {mark.status === 'leave' ? (
                    <span className="badge">on leave</span>
                  ) : (
                    STATUSES.map((st) => (
                      <button
                        key={st}
                        className={`att-opt ${mark.status === st ? `on-${st}` : ''}`}
                        onClick={() => setStatus(r.studentId, st)}
                      >
                        {st === 'half_day' ? '½ day' : st[0].toUpperCase() + st.slice(1)}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
