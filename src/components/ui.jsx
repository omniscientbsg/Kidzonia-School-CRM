export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  )
}

const STATUS_COLORS = {
  // shared status → badge color map
  new: 'plum', contacted: '', visit_scheduled: 'yellow', visited: 'yellow', demo: 'orange',
  negotiation: 'orange', converted: 'green', lost: 'red',
  draft: 'gray', submitted: '', waitlisted: 'yellow', offered: 'orange', confirmed: 'green', rejected: 'red',
  pending: 'yellow', partial: 'orange', paid: 'green', overdue: 'red', cancelled: 'gray',
  approved: 'green', open: 'yellow', done: 'green',
  present: 'green', absent: 'red', late: 'yellow', half_day: '', leave: '',
  active: 'green', on_leave: 'yellow', withdrawn: 'gray', alumni: 'plum',
  received: '', verified: 'green', success: 'green', initiated: 'yellow', failed: 'red',
}

export function Badge({ status, children, color }) {
  const cls = color ?? STATUS_COLORS[status] ?? 'gray'
  return <span className={`badge ${cls}`}>{children || String(status || '').replace(/_/g, ' ')}</span>
}

export function StatCard({ label, value, sub, tone }) {
  const tones = { orange: 'var(--marmalade-soft)', green: 'var(--teal-soft)', yellow: 'var(--sun-soft)', red: 'var(--berry-soft)', blue: 'var(--sky-soft)' }
  return (
    <div className="stat" style={{ '--accent-soft': tones[tone] || tones.orange }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

// The ONE accent block. Tinted panels used to carry four different jobs on a
// single screen — a warning, a summary, a call to action and a piece of
// evidence — so none of them read as more important than the others. A page
// gets at most one of these, and it is always the thing that needs a decision.
export function Callout({ tone = 'warn', icon = null, title, children, actions = null }) {
  const tones = {
    warn: { bg: 'var(--marmalade-soft)', fg: 'var(--marmalade-deep)', line: 'var(--marmalade)' },
    danger: { bg: 'var(--berry-soft)', fg: 'var(--berry)', line: 'var(--berry)' },
    good: { bg: 'var(--teal-soft)', fg: 'var(--teal)', line: 'var(--teal)' },
  }
  const t = tones[tone] || tones.warn
  return (
    <div className="card" style={{ background: t.bg, boxShadow: 'none', borderLeft: `3px solid ${t.line}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {icon && <span style={{ color: t.fg, flexShrink: 0, marginTop: 1, display: 'flex' }}>{icon}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          {title && <b style={{ color: t.fg, fontSize: 13.5, display: 'block' }}>{title}</b>}
          <div style={{ fontSize: 13, color: t.fg, marginTop: title ? 4 : 0 }}>{children}</div>
        </div>
        {actions}
      </div>
    </div>
  )
}

// A quiet panel for supporting detail — the read-back of a form, a piece of
// evidence. Deliberately not tinted: it is information, not a decision.
export function Note({ children, style }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.55, ...style }}>
      {children}
    </div>
  )
}

export function Empty({ emoji = '🍊', text = 'Nothing here yet' }) {
  return (
    <div className="empty">
      <span className="emoji">{emoji}</span>
      {text}
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

export function Spinner() {
  return <div className="empty">Loading…</div>
}

// Reusable confirm dialog for destructive / irreversible actions.
// tone 'danger' (default) paints the confirm button red; 'default' keeps orange.
export function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', busy = false, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      {message && <p style={{ margin: '0 0 16px', color: 'var(--ink-soft)', lineHeight: 1.5 }}>{message}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button className={`btn ${tone === 'danger' ? 'danger' : ''}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </Modal>
  )
}
