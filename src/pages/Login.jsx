import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useStore } from '../store/useStore'

const DEMO_ACCOUNTS = [
  ['superadmin@kidzonia.com', 'HQ Super Admin'],
  ['principal@kidzonia.com', 'Branch Principal'],
  ['frontdesk@kidzonia.com', 'Front Desk'],
  ['accounts@kidzonia.com', 'Accountant'],
  ['teacher@kidzonia.com', 'Teacher'],
  ['parent@kidzonia.com', 'Parent (2 kids)'],
]

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const login = useStore((s) => s.login)
  const navigate = useNavigate()

  async function submit(e, overrideEmail) {
    e?.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: overrideEmail || email, password: overrideEmail ? 'password' : password }),
      })
      let data = null
      try {
        data = await res.json()
      } catch (err) {
        // ignore parse error if response is empty (e.g. 502 from proxy)
      }
      if (!res.ok) {
        throw new Error(data?.error || (res.status === 502 || res.status === 504 ? 'Cannot connect to server. Please ensure the backend is running (use "npm run start" instead of "npm run dev").' : 'Login failed'))
      }
      login(data.token, data.user)
      // staff land on Today: what they owe, and what is holding their sign-off.
      // Parents keep their own home.
      navigate(data.user.role === 'parent' ? '/parent' : '/tasks', { replace: true })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-dots" />
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="brand-badge" style={{ width: 46, height: 46, fontSize: 24, borderRadius: 14 }}>🎒</div>
          <div>
            <h1 style={{ fontSize: 24 }}>Kidzonia</h1>
            <div className="muted">School CRM & Parent App</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@kidzonia.com" autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn" style={{ width: '100%', justifyContent: 'center', padding: '11px' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="muted" style={{ marginBottom: 8 }}>Demo accounts (password: <code>password</code>)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DEMO_ACCOUNTS.map(([em, label]) => (
              <button key={em} className="btn sm subtle" type="button" onClick={(e) => submit(e, em)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
