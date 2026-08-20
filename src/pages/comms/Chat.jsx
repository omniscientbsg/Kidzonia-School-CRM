import { useState, useEffect, useRef } from 'react'
import { Send, MessageSquarePlus } from 'lucide-react'
import { useGet, useAct, fmtDateTime, initials } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

function NewThreadModal({ onClose, onCreated }) {
  const act = useAct(['/chat/threads'])
  const { data: students = [] } = useGet('/students?status=active')
  const [studentId, setStudentId] = useState('')
  const [type, setType] = useState('parent_teacher')

  return (
    <Modal title="Start conversation" onClose={onClose}>
      <Field label="Student (context)">
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Choose student…</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
        </select>
      </Field>
      <Field label="Thread type">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="parent_teacher">Parent ↔ Teacher</option>
          <option value="parent_office">Parent ↔ Office</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!studentId} onClick={() => act.mutate(
          { path: '/chat/threads', body: { studentId, type } },
          { onSuccess: (thread) => { onCreated(thread); onClose() } }
        )}>Start chat</button>
      </div>
    </Modal>
  )
}

export default function Chat() {
  const { user } = useStore()
  const { data: threads = [], isLoading, refetch } = useGet('/chat/threads')
  const [activeId, setActiveId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [msgText, setMsgText] = useState('')
  const msgEndRef = useRef()
  const act = useAct(['/chat/threads'])

  const activePath = activeId ? `/chat/threads/${activeId}/messages` : null
  const { data: messages = [], refetch: refetchMsgs } = useGet(activePath || '/chat/threads', { enabled: !!activeId, poll: 5000 })

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

  return (
    <div>
      <div className="page-head">
        <h1>Chat</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><MessageSquarePlus size={15} /> New thread</button>
      </div>

      <div className="chat-layout">
        <div className="chat-list">
          {threads.length === 0 && <div className="empty">No threads yet</div>}
          {threads.map((t) => (
            <div key={t.id} className={`chat-thread-item ${t.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(t.id)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="avatar teal" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(t.otherName)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.otherName}</div>
                  <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.studentName ? `Re: ${t.studentName}` : t.type?.replace('_', ' ')}
                  </div>
                </div>
                {t.unreadCount > 0 && <Badge color="orange">{t.unreadCount}</Badge>}
              </div>
              {t.lastMessage && (
                <div className="muted" style={{ marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}>
                  {t.lastMessage.text}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="chat-pane">
          {!activeThread && <div className="empty" style={{ flex: 1, display: 'grid', placeItems: 'center' }}>Select a conversation</div>}
          {activeThread && (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="avatar teal" style={{ width: 32, height: 32, fontSize: 12 }}>{initials(activeThread.otherName)}</span>
                <div>
                  <b>{activeThread.otherName}</b>
                  {activeThread.studentName && <div className="muted">Re: {activeThread.studentName}</div>}
                </div>
              </div>
              <div className="chat-msgs">
                {messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.byId === user.id ? 'mine' : 'theirs'}`}>
                    {m.byId !== user.id && <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{m.byName}</div>}
                    {m.text}
                    <span className="when">{fmtDateTime(m.createdAt)}</span>
                  </div>
                ))}
                <div ref={msgEndRef} />
              </div>
              <form className="chat-input" onSubmit={sendMessage}>
                <input value={msgText} onChange={(e) => setMsgText(e.target.value)} placeholder="Type a message…" />
                <button className="btn" type="submit"><Send size={14} /></button>
              </form>
            </>
          )}
        </div>
      </div>

      {creating && <NewThreadModal onClose={() => setCreating(false)} onCreated={(t) => { setActiveId(t.id); refetch() }} />}
    </div>
  )
}
