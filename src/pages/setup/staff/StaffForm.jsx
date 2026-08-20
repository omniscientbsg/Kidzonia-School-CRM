import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Upload, X } from 'lucide-react'
import { useGet, useAct, initials } from '../../../api/hooks'
import { api, mediaUrl } from '../../../api/client'
import { Spinner, Field } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

const ROLE_OPTS = [
  ['super_admin', 'Super Admin'], ['branch_admin', 'School Admin'], ['front_desk', 'Front Desk'],
  ['accountant', 'Accountant'], ['teacher', 'Teacher'], ['daycare_staff', 'Day Care Staff'],
]

export default function StaffForm() {
  const { id } = useParams()
  const editing = !!id
  const { data: existing, isLoading: lex } = useGet(editing ? `/staff` : '/health')
  const { data: branches = [] } = useGet('/branches')
  const { data: classes = [], isLoading: lcls } = useGet('/classes')
  if ((editing && lex) || lcls) return <Spinner />
  const staff = editing ? (existing || []).find((s) => s.id === id) : null
  if (editing && !staff) return <div className="card"><p className="muted">Staff member not found.</p></div>
  return <StaffFormInner editing={editing} staff={staff} branches={branches} classes={classes} />
}

function StaffFormInner({ editing, staff, branches, classes }) {
  const navigate = useNavigate()
  const { user } = useStore()
  const isSuper = user.role === 'super_admin'
  const act = useAct(['/staff', '/users'])
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => ({
    name: staff?.name || '',
    username: staff?.username || '',
    role: staff?.role || 'teacher',
    branchId: staff?.branchId || user.branchId || branches[0]?.id || '',
    designation: staff?.designation || '',
    subjectsText: (staff?.subjects || []).join(', '),
    classTeacherOf: staff?.classTeacherOf || [],
    subjectTeacher: !!staff?.subjectTeacher,
    groupAdmin: !!staff?.groupAdmin,
    phone: staff?.phone || '',
    password: '',
    photoId: staff?.photoId || null,
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const branchId = isSuper ? form.branchId : user.branchId
  const branchClasses = classes.filter((c) => c.active !== false && (!branchId || c.branchId === branchId))
  const digits = form.phone.replace(/\D/g, '')
  const phoneOk = !form.phone || digits.length >= 10
  const valid = form.name.trim() && form.username.trim() && form.role && phoneOk

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (branchId) fd.append('branchId', branchId)
      const asset = await api.upload('/media', fd)
      set('photoId', asset.id)
    } catch (err) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function toggleClass(cid) {
    setForm((f) => ({ ...f, classTeacherOf: f.classTeacherOf.includes(cid) ? f.classTeacherOf.filter((x) => x !== cid) : [...f.classTeacherOf, cid] }))
  }

  async function submit() {
    setSaving(true)
    const body = {
      name: form.name.trim(), username: form.username.trim(), role: form.role,
      designation: form.designation.trim(), phone: form.phone.trim() || null,
      subjects: form.subjectsText.split(',').map((s) => s.trim()).filter(Boolean),
      classTeacherOf: form.classTeacherOf, subjectTeacher: form.subjectTeacher, groupAdmin: form.groupAdmin,
      photoId: form.photoId,
    }
    if (isSuper) body.branchId = form.branchId
    if (form.password) body.password = form.password
    try {
      if (editing) await act.mutateAsync({ method: 'put', path: `/staff/${staff.id}`, body })
      else await act.mutateAsync({ path: '/staff', body })
      toast.success(editing ? 'Staff updated' : `Staff created — login: ${body.username} / ${form.password || 'password'}`)
      navigate('/setup/staff')
    } catch (err) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <button className="btn sm ghost" onClick={() => navigate('/setup/staff')} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> Back to staff</button>
      <div className="card" style={{ maxWidth: 780 }}>
        <div className="card-title"><h3>{editing ? 'Edit staff' : 'Create staff'}</h3></div>

        {/* photo */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
          <div style={{ width: 74, height: 74, borderRadius: 14, overflow: 'hidden', background: 'var(--marmalade-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, color: 'var(--marmalade-deep)', fontSize: 22 }}>
            {form.photoId ? <img src={mediaUrl(form.photoId)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (initials(form.name) || '?')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
            <button className="btn sm ghost" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={13} /> {uploading ? 'Uploading…' : 'Upload photo'}</button>
            {form.photoId && <button className="btn sm ghost" onClick={() => set('photoId', null)}><X size={13} /> Remove</button>}
          </div>
        </div>

        <div className="form-row">
          <Field label="Full name *"><input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
          <Field label="Employee ID"><input value={editing ? (staff.employeeId || '—') : 'auto (EMP/…)'} disabled /></Field>
        </div>

        <div className="form-row">
          <Field label="Designation"><input value={form.designation} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. Class Teacher" /></Field>
          <Field label="Mobile number">
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />
          </Field>
        </div>
        {!phoneOk && <div style={{ color: 'var(--berry)', fontSize: 12.5, marginTop: -6, marginBottom: 10 }}>Enter a valid mobile number (≥10 digits).</div>}

        <Field label="Subjects"><input value={form.subjectsText} onChange={(e) => set('subjectsText', e.target.value)} placeholder="comma separated e.g. English, Rhymes" /></Field>

        <div className="form-row">
          <Field label="Username / login *"><input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="e.g. aanya.khan" /></Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>

        <div className="form-row">
          {isSuper && (
            <Field label="Branch">
              <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={editing ? 'Reset password (optional)' : 'Password'}>
            <input type="text" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={editing ? 'leave blank to keep' : 'default: password'} />
          </Field>
        </div>

        <Field label="Class-Teacher assignments">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {branchClasses.map((c) => {
              const on = form.classTeacherOf.includes(c.id)
              return (
                <button type="button" key={c.id} onClick={() => toggleClass(c.id)} className={`badge ${on ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>
                  {on ? '✓ ' : ''}{c.name}
                </button>
              )
            })}
            {branchClasses.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>No classes in this branch.</span>}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 18, margin: '10px 0 4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <input type="checkbox" checked={form.subjectTeacher} onChange={(e) => set('subjectTeacher', e.target.checked)} /> Subject Teacher
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <input type="checkbox" checked={form.groupAdmin} onChange={(e) => set('groupAdmin', e.target.checked)} /> Group Admin
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn ghost" onClick={() => navigate('/setup/staff')} disabled={saving}>Cancel</button>
          <button className="btn" disabled={!valid || saving || uploading} onClick={submit}>{editing ? 'Save changes' : 'Create staff'}</button>
        </div>
      </div>
    </div>
  )
}
