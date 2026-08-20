import { useEffect, useState } from 'react'
import { LogIn, LogOut as LogOutIcon } from 'lucide-react'
import { useGet, useAct, todayISO, initials } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'

function PickupModal({ student, onClose }) {
  const act = useAct(['/check-in-out'])
  const [person, setPerson] = useState('')
  return (
    <Modal title={`Check out — ${student.name}`} onClose={onClose}>
      <Field label="Pickup person">
        <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Mother, Driver Ramesh" autoFocus />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" onClick={() => act.mutate(
          { path: '/check-in-out', body: { studentId: student.studentId, action: 'out', pickupPerson: person || null }, success: `${student.name} checked out — guardian notified` },
          { onSuccess: onClose }
        )}>
          <LogOutIcon size={14} /> Check out
        </button>
      </div>
    </Modal>
  )
}

export default function CheckInOut() {
  const { data: sections = [] } = useGet('/sections')
  const { data: classes = [] } = useGet('/classes')
  const [sectionId, setSectionId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [pickupFor, setPickupFor] = useState(null)
  const act = useAct(['/check-in-out'])

  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id) }, [sections, sectionId])

  const sectionName = (s) => `${classes.find((c) => c.id === s.classId)?.name || ''} — ${s.name}`
  const rosterPath = sectionId ? `/check-in-out?sectionId=${sectionId}&date=${date}` : null
  const { data: roster = [], isLoading } = useGet(rosterPath || '/check-in-out?sectionId=none&date=none', { enabled: !!sectionId })

  function checkIn(studentId, name) {
    act.mutate({ path: '/check-in-out', body: { studentId, action: 'in' }, success: `${name} checked in — guardian notified` })
  }

  return (
    <div>
      <div className="page-head">
        <h1>Check-in / Check-out</h1>
        <div className="spacer" />
        <div className="filters">
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {isLoading && <Spinner />}
      {!isLoading && roster.length === 0 && <Empty emoji="🚸" text="No students in this section" />}
      {!isLoading && roster.length > 0 && (
        <div className="card">
          {roster.map((r) => (
            <div key={r.studentId} className="att-row">
              <span className="avatar">{initials(r.name)}</span>
              <div style={{ flex: 1 }}>
                <b>{r.name}</b>
                <div className="muted">Roll {r.rollNo}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {r.record?.inAt && <Badge color="green">In: {r.record.inAt}</Badge>}
                {r.record?.outAt && <Badge color="gray">Out: {r.record.outAt}{r.record.pickupPerson ? ` (${r.record.pickupPerson})` : ''}</Badge>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!r.record?.inAt && (
                  <button className="btn sm" onClick={() => checkIn(r.studentId, r.name)}>
                    <LogIn size={13} /> In
                  </button>
                )}
                {r.record?.inAt && !r.record?.outAt && (
                  <button className="btn sm danger" onClick={() => setPickupFor(r)}>
                    <LogOutIcon size={13} /> Out
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {pickupFor && <PickupModal student={pickupFor} onClose={() => setPickupFor(null)} />}
    </div>
  )
}
