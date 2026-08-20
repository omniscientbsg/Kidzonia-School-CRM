import { useState } from 'react'
import { useGet, useAct, initials } from '../../api/hooks'
import { Spinner, Empty, Badge, Field } from '../../components/ui'
import { useStore } from '../../store/useStore'

const CHANNELS = ['inApp', 'push', 'sms', 'whatsapp', 'email']
const CHANNEL_LABELS = { inApp: 'In-App', push: 'Push', sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' }

export default function ParentProfile() {
  const { user } = useStore()
  const { data: children = [] } = useGet('/parent/children')
  const { data: prefs, isLoading: prefsLoading } = useGet('/me/notification-prefs')
  const { data: consents = [] } = useGet('/parent/consents')
  const act = useAct(['/me/notification-prefs', '/parent/consents'])
  const [tab, setTab] = useState('guardians')

  // Find guardians for the active child
  const { activeChildId } = useStore()
  const activeChild = children.find((c) => c.id === activeChildId)

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>Profile & Settings</h2>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>{initials(user.name)}</span>
          <div>
            <b style={{ fontSize: 16 }}>{user.name}</b>
            <div className="muted">{user.email}</div>
            <div className="muted">{user.phone}</div>
          </div>
        </div>
      </div>

      <div className="tabs">
        {['guardians', 'consents', 'notifications'].map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'guardians' && (
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Children</h3>
          {children.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #f4efe6', alignItems: 'center' }}>
              <span className="avatar teal">{initials(`${c.firstName} ${c.lastName}`)}</span>
              <div>
                <b>{c.firstName} {c.lastName}</b>
                <div className="muted">{c.className ? `${c.className} — ${c.sectionName}` : '—'} · Roll {c.rollNo || '—'}</div>
              </div>
              <Badge status={c.status} />
            </div>
          ))}
        </div>
      )}

      {tab === 'consents' && (
        <div className="card">
          <h3 style={{ marginBottom: 6 }}>Media sharing consent</h3>
          <p className="muted" style={{ marginBottom: 14 }}>Control whether your child's photos/videos can be shared via the school app.</p>
          {consents.length === 0 && <Empty emoji="🔒" text="No consents to manage" />}
          {consents.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f4efe6' }}>
              <div>
                <b>{c.studentName}</b>
                <div className="muted">{c.type?.replace('_', ' ')}</div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <span className="muted">{c.granted ? 'Granted' : 'Revoked'}</span>
                <input
                  type="checkbox"
                  checked={c.granted}
                  onChange={(e) => act.mutate({ method: 'put', path: `/parent/consents/${c.id}`, body: { granted: e.target.checked }, success: e.target.checked ? 'Consent granted' : 'Consent revoked' })}
                  style={{ accentColor: 'var(--marmalade)', width: 18, height: 18 }}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="card">
          <h3 style={{ marginBottom: 6 }}>Notification preferences</h3>
          <p className="muted" style={{ marginBottom: 14 }}>Choose how you want to receive notifications. In-app is always enabled.</p>
          {prefsLoading ? <Spinner /> : (
            <div>
              {CHANNELS.map((ch) => (
                <div key={ch} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f4efe6' }}>
                  <b>{CHANNEL_LABELS[ch]}</b>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                    <span className="muted">{prefs?.[ch] ? 'On' : 'Off'}</span>
                    <input
                      type="checkbox"
                      checked={prefs?.[ch] || false}
                      disabled={ch === 'inApp'}
                      onChange={(e) => act.mutate({ method: 'put', path: '/me/notification-prefs', body: { [ch]: e.target.checked }, success: 'Preferences saved' })}
                      style={{ accentColor: 'var(--marmalade)', width: 18, height: 18 }}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
