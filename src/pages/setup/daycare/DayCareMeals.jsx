import { useState } from 'react'
import { Plus, Trash2, Pencil, AlertTriangle, Send, Clock, BookOpen } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner']
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]
const SETUP_ROLES = ['super_admin', 'branch_admin', 'daycare_staff']

function MealModal({ sessionId, dishes, meal, preset, onClose }) {
  const editing = !!meal
  const act = useAct(['/dc-menu'])
  const [form, setForm] = useState({
    mealType: meal?.mealType || preset?.mealType || 'breakfast',
    dayOfWeek: meal?.dayOfWeek ?? preset?.dayOfWeek ?? 1,
    name: meal?.name || '',
    description: meal?.description || '',
    dishIds: meal?.dishIds || [],
    showStartTime: meal?.showStartTime ?? true,
    startTime: meal?.startTime || '08:30',
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const toggleDish = (id) => setForm((f) => ({ ...f, dishIds: f.dishIds.includes(id) ? f.dishIds.filter((x) => x !== id) : [...f.dishIds, id] }))

  function save() {
    const body = { sessionId, mealType: form.mealType, dayOfWeek: Number(form.dayOfWeek), name: form.name.trim(), description: form.description.trim(), dishIds: form.dishIds, showStartTime: form.showStartTime, startTime: form.showStartTime ? form.startTime : null }
    if (editing) act.mutate({ method: 'put', path: `/dc-meals/${meal.id}`, body, success: 'Meal updated' }, { onSuccess: onClose })
    else act.mutate({ path: '/dc-meals', body, success: 'Meal added' }, { onSuccess: onClose })
  }

  return (
    <Modal title={editing ? 'Edit meal' : 'Add meal'} onClose={onClose} wide>
      <div className="form-row">
        <Field label="Meal type">
          <select value={form.mealType} onChange={(e) => set('mealType', e.target.value)}>
            {MEAL_TYPES.map((m) => <option key={m} value={m} style={{ textTransform: 'capitalize' }}>{m}</option>)}
          </select>
        </Field>
        <Field label="Day">
          <select value={form.dayOfWeek} onChange={(e) => set('dayOfWeek', e.target.value)}>
            {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Idli Breakfast" autoFocus /></Field>
      <Field label="Description"><textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>
      <Field label="Meal options (dishes)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {dishes.map((d) => {
            const on = form.dishIds.includes(d.id)
            return (
              <button type="button" key={d.id} onClick={() => toggleDish(d.id)} className={`badge ${on ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>
                {on ? '✓ ' : ''}{d.name}{d.allergens?.length ? ` ⚠️` : ''}
              </button>
            )
          })}
          {dishes.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>No dishes yet — add some in the dish library.</span>}
        </div>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, margin: '4px 0 10px' }}>
        <input type="checkbox" checked={form.showStartTime} onChange={(e) => set('showStartTime', e.target.checked)} /> Show start time
      </label>
      {form.showStartTime && <Field label="Start time"><input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.name.trim() || act.isPending} onClick={save}>{editing ? 'Save' : 'Add meal'}</button>
      </div>
    </Modal>
  )
}

function DishLibrary({ dishes, onClose }) {
  const act = useAct(['/dishes', '/dc-menu'])
  const [name, setName] = useState('')
  const [allergens, setAllergens] = useState('')
  function add() {
    act.mutate({ path: '/dishes', body: { name: name.trim(), allergens: allergens.split(',').map((a) => a.trim()).filter(Boolean) }, success: 'Dish added' })
    setName(''); setAllergens('')
  }
  return (
    <Modal title="Dish library" onClose={onClose}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {dishes.map((d) => (
          <Badge key={d.id} color={d.allergens?.length ? 'red' : 'gray'}>{d.name}{d.allergens?.length ? ` · ${d.allergens.join(', ')}` : ''}</Badge>
        ))}
        {dishes.length === 0 && <span className="muted">No dishes yet.</span>}
      </div>
      <div className="form-row">
        <Field label="Dish name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Idli & Sambar" /></Field>
        <Field label="Allergens (comma)"><input value={allergens} onChange={(e) => setAllergens(e.target.value)} placeholder="e.g. Peanuts, Dairy" /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn sm" disabled={!name.trim() || act.isPending} onClick={add}><Plus size={13} /> Add dish</button>
      </div>
    </Modal>
  )
}

export default function DayCareMeals() {
  const { user, activeSessionId } = useStore()
  const canManage = SETUP_ROLES.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const [sessionId, setSessionId] = useState(activeSessionId || '')
  const qs = sessionId ? `?sessionId=${sessionId}` : ''
  const { data, isLoading, isError, error } = useGet(`/dc-menu${qs}`)
  const act = useAct(['/dc-menu'])
  const [modal, setModal] = useState(null) // { meal } | { preset }
  const [showDishes, setShowDishes] = useState(false)

  const nonArchived = sessions.filter((s) => !s.archived)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load menu'} /></div>
  if (!data?.session) return <div className="card"><Empty emoji="🍽" text="No active session" /></div>

  const { meals, dishes, session } = data
  const cell = (day, type) => meals.filter((m) => m.dayOfWeek === day && m.mealType === type)
  const allWarnings = meals.flatMap((m) => m.allergyWarnings.map((w) => ({ ...w, meal: m.name })))
  const published = meals.length > 0 && meals.every((m) => m.published)

  function del(m) { act.mutate({ method: 'del', path: `/dc-meals/${m.id}`, success: 'Meal removed' }) }
  function publish() { act.mutate({ path: '/dc-menu/publish', body: { sessionId: session.id, published: !published }, success: published ? 'Menu unpublished' : 'Menu published to parents' }) }

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Active session</option>
            {nonArchived.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
          </select>
        </div>
        <div className="spacer" />
        {canManage && <button className="btn ghost" onClick={() => setShowDishes(true)}><BookOpen size={15} /> Dish library</button>}
        {canManage && <button className="btn ghost" onClick={publish} disabled={!meals.length}><Send size={15} /> {published ? 'Unpublish' : 'Publish to parents'}</button>}
        {canManage && <button className="btn" onClick={() => setModal({ preset: { dayOfWeek: 1, mealType: 'breakfast' } })}><Plus size={15} /> Add meal</button>}
      </div>

      {published && <div style={{ marginBottom: 12 }}><Badge color="green">Menu published to parents</Badge></div>}

      {allWarnings.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--berry)', background: 'var(--berry-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--berry)', fontWeight: 700, marginBottom: 6 }}>
            <AlertTriangle size={16} /> Allergy warnings ({allWarnings.length})
          </div>
          <div style={{ fontSize: 13, color: 'var(--berry)' }}>
            {allWarnings.map((w, i) => <div key={i}>{w.name} — <b>{w.allergens.join(', ')}</b> in “{w.meal}”</div>)}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th style={{ textTransform: 'capitalize' }}>Meal</th>{DAYS.map(([v, l]) => <th key={v} style={{ minWidth: 130 }}>{l}</th>)}</tr>
          </thead>
          <tbody>
            {MEAL_TYPES.map((type) => (
              <tr key={type}>
                <td style={{ textTransform: 'capitalize', fontWeight: 700 }}>{type}</td>
                {DAYS.map(([day]) => (
                  <td key={day} style={{ verticalAlign: 'top' }}>
                    {cell(day, type).map((m) => (
                      <div key={m.id} style={{ background: 'var(--surface-2, #faf7f1)', border: '1px solid var(--line)', borderRadius: 8, padding: 7, marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <b style={{ fontSize: 12.5, flex: 1 }}>{m.name}</b>
                          {m.allergyWarnings.length > 0 && <AlertTriangle size={13} style={{ color: 'var(--berry)' }} />}
                        </div>
                        {m.showStartTime && m.startTime && <div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={10} />{m.startTime}</div>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, margin: '4px 0' }}>
                          {m.dishes.map((d) => <span key={d.id} className="badge gray" style={{ fontSize: 10.5 }}>{d.name}</span>)}
                        </div>
                        {canManage && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn sm ghost" style={{ padding: '2px 6px' }} onClick={() => setModal({ meal: m })}><Pencil size={11} /></button>
                            <button className="btn sm ghost" style={{ padding: '2px 6px' }} onClick={() => del(m)}><Trash2 size={11} /></button>
                          </div>
                        )}
                      </div>
                    ))}
                    {canManage && cell(day, type).length === 0 && (
                      <button className="btn sm ghost" style={{ opacity: 0.5, padding: '2px 6px' }} onClick={() => setModal({ preset: { dayOfWeek: day, mealType: type } })}><Plus size={11} /></button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <MealModal sessionId={session.id} dishes={dishes} meal={modal.meal} preset={modal.preset} onClose={() => setModal(null)} />}
      {showDishes && <DishLibrary dishes={dishes} onClose={() => setShowDishes(false)} />}
    </div>
  )
}
