import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { Plus, LayoutGrid, List, AlertTriangle } from 'lucide-react'
import { useGet, useAct } from '../../api/hooks'
import { api } from '../../api/client'
import { Modal, Badge, Field, Spinner, Empty } from '../../components/ui'

const STAGES = ['new', 'contacted', 'visit_scheduled', 'visited', 'demo', 'negotiation', 'converted', 'lost']
const STAGE_LABEL = { new: 'New', contacted: 'Contacted', visit_scheduled: 'Visit scheduled', visited: 'Visited', demo: 'Demo / Trial', negotiation: 'Negotiation', converted: 'Converted', lost: 'Lost' }
const SOURCES = ['walk_in', 'phone', 'website', 'whatsapp', 'referral', 'ads', 'event', 'parent_app']

function QuickAdd({ programs, onClose }) {
  const act = useAct(['/leads', '/crm'])
  const [form, setForm] = useState({ childName: '', childDob: '', programId: programs[0]?.id || '', parentName: '', phone: '', email: '', source: 'walk_in' })
  const [dupes, setDupes] = useState([])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function checkDupes() {
    if (!form.phone && !form.childName) return
    const q = new URLSearchParams({ phone: form.phone, childName: form.childName }).toString()
    const res = await api.get(`/leads/check-duplicate?${q}`).catch(() => ({ duplicates: [] }))
    setDupes(res.duplicates || [])
  }

  function submit(e) {
    e.preventDefault()
    act.mutate(
      { path: '/leads', body: form, success: 'Enquiry captured' },
      { onSuccess: onClose }
    )
  }

  return (
    <Modal title="New enquiry" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Child's name"><input required value={form.childName} onChange={set('childName')} onBlur={checkDupes} autoFocus /></Field>
          <Field label="Date of birth"><input type="date" value={form.childDob} onChange={set('childDob')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Program of interest">
            <select value={form.programId} onChange={set('programId')}>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select value={form.source} onChange={set('source')}>
              {SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row-3">
          <Field label="Parent's name"><input required value={form.parentName} onChange={set('parentName')} /></Field>
          <Field label="Phone"><input required value={form.phone} onChange={set('phone')} onBlur={checkDupes} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        {dupes.length > 0 && (
          <div className="badge yellow" style={{ marginBottom: 12 }}>
            <AlertTriangle size={12} /> Possible duplicate: {dupes[0].childName} ({dupes[0].phone})
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={act.isPending}>Save enquiry</button>
        </div>
      </form>
    </Modal>
  )
}

function LostModal({ lead, onClose }) {
  const act = useAct(['/leads', '/crm'])
  const [reason, setReason] = useState('')
  return (
    <Modal title={`Mark "${lead.childName}" as lost`} onClose={onClose}>
      <Field label="Why was this lead lost?">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fees higher than budget" autoFocus />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn danger"
          disabled={!reason}
          onClick={() => act.mutate({ path: `/leads/${lead.id}/stage`, body: { stage: 'lost', lostReason: reason }, success: 'Lead marked lost' }, { onSuccess: onClose })}
        >
          Mark lost
        </button>
      </div>
    </Modal>
  )
}

export default function Leads() {
  const navigate = useNavigate()
  const { data: leads = [], isLoading } = useGet('/leads')
  const { data: programs = [] } = useGet('/programs')
  const { data: analytics } = useGet('/crm/analytics')
  const act = useAct(['/leads', '/crm'])
  const [view, setView] = useState('kanban')
  const [adding, setAdding] = useState(false)
  const [losing, setLosing] = useState(null)
  const [sourceFilter, setSourceFilter] = useState('')

  const filtered = sourceFilter ? leads.filter((l) => l.source === sourceFilter) : leads
  const progName = (id) => programs.find((p) => p.id === id)?.name || '—'

  function onDragEnd({ draggableId, destination }) {
    if (!destination) return
    const stage = destination.droppableId
    const lead = leads.find((l) => l.id === draggableId)
    if (!lead || lead.stage === stage) return
    if (stage === 'lost') return setLosing(lead)
    if (stage === 'converted') {
      act.mutate({ path: `/leads/${lead.id}/convert`, body: {}, success: 'Converted to application' })
      return
    }
    act.mutate({ path: `/leads/${lead.id}/stage`, body: { stage } })
  }

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head">
        <h1>Enquiries</h1>
        {analytics && (
          <span className="badge orange">{analytics.total} leads · {analytics.conversionPct}% converted</span>
        )}
        <div className="spacer" />
        <div className="filters">
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button className="icon-btn" onClick={() => setView(view === 'kanban' ? 'list' : 'kanban')} title="Toggle view">
            {view === 'kanban' ? <List size={16} /> : <LayoutGrid size={16} />}
          </button>
          <button className="btn" onClick={() => setAdding(true)}><Plus size={15} /> New enquiry</button>
        </div>
      </div>

      {view === 'kanban' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="kanban">
            {STAGES.map((stage) => {
              const items = filtered.filter((l) => l.stage === stage)
              return (
                <Droppable droppableId={stage} key={stage}>
                  {(provided) => (
                    <div className="kanban-col" ref={provided.innerRef} {...provided.droppableProps}>
                      <h4>{STAGE_LABEL[stage]}<span>{items.length}</span></h4>
                      {items.map((lead, i) => (
                        <Draggable draggableId={lead.id} index={i} key={lead.id}>
                          {(p) => (
                            <div
                              className="kanban-card"
                              ref={p.innerRef}
                              {...p.draggableProps}
                              {...p.dragHandleProps}
                              onClick={() => navigate(`/crm/leads/${lead.id}`)}
                            >
                              <b>{lead.childName}</b>
                              <div className="muted">{progName(lead.programId)} · {lead.parentName}</div>
                              <div style={{ marginTop: 6 }}><Badge color="gray">{lead.source?.replace('_', ' ')}</Badge></div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              )
            })}
          </div>
        </DragDropContext>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Child</th><th>Parent</th><th>Phone</th><th>Program</th><th>Source</th><th>Stage</th></tr></thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => navigate(`/crm/leads/${l.id}`)}>
                  <td><b>{l.childName}</b></td>
                  <td>{l.parentName}</td>
                  <td>{l.phone}</td>
                  <td>{progName(l.programId)}</td>
                  <td>{l.source?.replace('_', ' ')}</td>
                  <td><Badge status={l.stage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <Empty text="No enquiries match" />}
        </div>
      )}

      {adding && <QuickAdd programs={programs} onClose={() => setAdding(false)} />}
      {losing && <LostModal lead={losing} onClose={() => setLosing(null)} />}
    </div>
  )
}
