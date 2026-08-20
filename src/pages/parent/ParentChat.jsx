import { useState, useEffect, useRef } from 'react'
import { Send, MessageSquarePlus } from 'lucide-react'
import { useGet, useAct, fmtDateTime, initials } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

function NewThreadModal({ children, onClose, onCreated }) {
  const act = useAct(['/chat/threads'])
  const [studentId, setStudentId] = useState(children[0]?.id || '')
  const [type, setType] = useState('parent_teacher')

  return (
    <Modal title="Start conversation" onClose={onClose}>
      <Field label="Child">
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {children.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
      </Field>
      <Field label="Chat with">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="parent_teacher">Class Teacher</option>
          <option value="parent_office">Office</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => act.mutate(
          { path: '/chat/threads', body: { studentId, type } },
          { onSuccess: (t) => { onCreated(t); onClose() } }
        )}>Start chat</button>
      </div>
    </Modal>
  )
}

export default function ParentChat() {
  const { user } = useStore()
  const { data: children = [] } = useGet('/parent/children')
  const { data: threads = [], isLoading, refetch } = useGet('/chat/threads')
  const [activeId, setActiveId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [msgText, setMsgText] = useState('')
  const msgEndRef = useRef()
  const act = useAct(['/chat/threads'])

  const { data: messages = [], refetch: refetchMsgs } = useGet(
    activeId ? `/chat/threads/${activeId}/messages` : '/chat/threads',
    { enabled: !!activeId, poll: 5000 }
  )

  useEffect(() => { if (!activeId && threads.length) setActiveId(threads[0].id) }, [threads, activeId])
  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const activeThread = threads.find((t) => t.id === activeId)

  function sendMessage(e) {
    e?.preventDefault()
    if (!msgText.trim() || !activeId) return
    act.mutate(
      { path: `/chat/threads/${activeId}/messages`, body: { text: msgText.trim() } },
      { onSuccess: () => { setMsgText(''); refetchMsgs(); refetch() } }
    )
  }

  if (isLoading) return <Spinner />

  // Mobile: show threads list or message pane
  if (!activeId || !activeThread) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2>Chat</h2>
          <button className="btn sm" onClick={() => setCreating(true)}><MessageSquarePlus size={14} /></button>
        </div>
        {threads.length === 0 && <Empty emoji="💬" text="No conversations yet" />}
        {threads.map((t) => (
          <div key={t.id} className="card" style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => setActiveId(t.id)}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="avatar teal" style={{ width: 36, height: 36, fontSize: 13 }}>{initials(t.otherName)}</span>
              <div style={{ flex: 1 }}>
                <b>{t.otherName}</b>
                {t.studentName && <div className="muted">Re: {t.studentName}</div>}
              </div>
              {t.unreadCount > 0 && <Badge color="orange">{t.unreadCount}</Badge>}
            </div>
          </div>
        ))}
        {creating && <NewThreadModal children={children} onClose={() => setCreating(false)} onCreated={(t) => { setActiveId(t.id); refetch() }} />}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button className="btn sm ghost" onClick={() => setActiveId(null)}>‹ Back</button>
        <span className="avatar teal" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(activeThread.otherName)}</span>
        <div>
          <b>{activeThread.otherName}</b>
          {activeThread.studentName && <div className="muted">Re: {activeThread.studentName}</div>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.byId === user.id ? 'mine' : 'theirs'}`}>
            {m.text}
            <span className="when">{fmtDateTime(m.createdAt)}</span>
          </div>
        ))}
        <div ref={msgEndRef} />
      </div>
      <form style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }} onSubmit={sendMessage}>
        <input value={msgText} onChange={(e) => setMsgText(e.target.value)} placeholder="Type a message…" style={{ flex: 1, padding: '9px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 14 }} />
        <button className="btn" type="submit"><Send size={14} /></button>
      </form>
    </div>
  )
}
