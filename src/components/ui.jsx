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
