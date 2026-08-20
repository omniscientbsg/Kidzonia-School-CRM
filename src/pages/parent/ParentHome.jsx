import { useState } from 'react'
import { Heart, MessageCircle, Send, BookOpen } from 'lucide-react'
import { useGet, useAct, fmtDateTime, fmtDate, initials } from '../../api/hooks'
import { mediaUrl } from '../../api/client'
import { Spinner, Empty, Badge } from '../../components/ui'
import { useStore } from '../../store/useStore'

const LOG_EMOJI = { meal: '🍽️', nap: '😴', diaper: '🧷', mood: '😊', health: '🩺' }

function TodayStrip({ childId }) {
  const { data, isLoading } = useGet(`/parent/children/${childId}/today`)
  if (isLoading || !data) return null

  const meal = data.logs.find((l) => l.type === 'meal')
  const nap = data.logs.find((l) => l.type === 'nap')
  const mood = data.logs.find((l) => l.type === 'mood')
  const health = data.logs.find((l) => l.type === 'health')

  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ marginBottom: 8, fontSize: 15 }}>Today</h3>
      <div className="today-strip">
        <div className="today-tile">
          <div className="emoji">🚸</div>
          <b>{data.checkInOut?.inAt ? `In ${data.checkInOut.inAt}` : 'Not in'}</b>
          <span>{data.checkInOut?.outAt ? `Out ${data.checkInOut.outAt}` : ''}</span>
        </div>
        <div className="today-tile">
          <div className="emoji">🍽️</div>
          <b>{meal ? `Ate ${meal.data?.ate || '—'}` : 'No meal log'}</b>
          <span>{meal?.data?.items || ''}</span>
        </div>
        <div className="today-tile">
          <div className="emoji">😴</div>
          <b>{nap ? `${nap.data?.start}–${nap.data?.end}` : 'No nap log'}</b>
        </div>
        <div className="today-tile">
          <div className="emoji">😊</div>
          <b>{mood?.data?.mood || '—'}</b>
          <span>{mood?.data?.note || ''}</span>
        </div>
        {health?.data?.flag && (
          <div className="today-tile" style={{ borderColor: 'var(--berry)' }}>
            <div className="emoji">🩺</div>
            <b style={{ color: 'var(--berry)' }}>{health.data.flag}</b>
          </div>
        )}
        <div className="today-tile">
          <div className="emoji">📝</div>
          <b>{data.attendance?.status || '—'}</b>
          <span>Attendance</span>
        </div>
      </div>
    </div>
  )
}

function FeedCard({ post }) {
  const { user } = useStore()
  const act = useAct(['/parent/feed'])
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')

  return (
    <div className="feed-card">
      <div className="feed-head">
        <span className="avatar plum" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(post.authorName)}</span>
        <div>
          <b style={{ fontSize: 13.5 }}>{post.authorName}</b>
          <div className="muted">{fmtDateTime(post.publishedAt)}</div>
        </div>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{post.text}</div>
      {post.mediaIds?.length > 0 && (
        <div className="feed-media">
          {post.mediaIds.map((id) => <img key={id} src={mediaUrl(id)} alt="" />)}
        </div>
      )}
      <div className="feed-actions">
        <button className={post.likedByMe ? 'on' : ''} onClick={() => act.mutate({ path: `/diary-posts/${post.id}/like` })}>
          <Heart size={14} fill={post.likedByMe ? 'currentColor' : 'none'} /> {post.likeCount || ''}
        </button>
        <button onClick={() => setShowComments(!showComments)}>
          <MessageCircle size={14} /> {post.comments?.length || ''}
        </button>
      </div>
      {showComments && (
        <div style={{ marginTop: 8 }}>
          {post.comments?.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f4efe6' }}>
              <b>{c.byName}</b>: {c.text}
            </div>
          ))}
          <form style={{ display: 'flex', gap: 6, marginTop: 6 }} onSubmit={(e) => {
            e.preventDefault()
            if (!commentText.trim()) return
            act.mutate({ path: `/diary-posts/${post.id}/comments`, body: { text: commentText.trim() } })
            setCommentText('')
          }}>
            <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Comment…" style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 12.5 }} />
            <button className="btn sm" type="submit"><Send size={11} /></button>
          </form>
        </div>
      )}
    </div>
  )
}

function Homework({ childId }) {
  const { data } = useGet(`/parent/children/${childId}/today`)
  const hw = data?.homework || []
  if (!hw.length) return null
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ marginBottom: 8, fontSize: 15 }}><BookOpen size={16} style={{ verticalAlign: -2 }} /> Homework</h3>
      {hw.map((h) => (
        <div key={h.id} className="card" style={{ padding: '10px 14px', marginBottom: 8 }}>
          <b>{h.title}</b>
          {h.description && <div className="muted">{h.description}</div>}
          {h.dueDate && <div className="muted">Due {fmtDate(h.dueDate)}</div>}
        </div>
      ))}
    </div>
  )
}

export default function ParentHome() {
  const { activeChildId } = useStore()
  const { data: feed = [], isLoading } = useGet('/parent/feed')

  if (!activeChildId) return <Spinner />

  return (
    <div>
      <TodayStrip childId={activeChildId} />
      <Homework childId={activeChildId} />

      <h3 style={{ marginBottom: 10, fontSize: 15 }}>Activity Feed</h3>
      {isLoading && <Spinner />}
      {!isLoading && feed.length === 0 && <Empty emoji="📖" text="No activity yet" />}
      {feed.map((p) => <FeedCard key={p.id} post={p} />)}
    </div>
  )
}
