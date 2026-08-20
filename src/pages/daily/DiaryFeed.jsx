import { useState, useRef } from 'react'
import { Heart, MessageCircle, Send, Trash2, Camera } from 'lucide-react'
import { useGet, useAct, fmtDateTime, initials } from '../../api/hooks'
import { api, mediaUrl } from '../../api/client'
import { Badge, Field, Spinner, Empty } from '../../components/ui'
import { useStore } from '../../store/useStore'

function Composer({ sections, onPosted }) {
  const act = useAct(['/diary-posts'])
  const [sectionId, setSectionId] = useState(sections[0]?.id || '')
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [posting, setPosting] = useState(false)
  const fileRef = useRef()

  async function post() {
    if (!sectionId || !text.trim()) return
    setPosting(true)
    try {
      let mediaIds = []
      for (const f of files) {
        const fd = new FormData()
        fd.append('file', f)
        const asset = await api.upload('/media', fd)
        mediaIds.push(asset.id)
      }
      await act.mutateAsync({
        path: '/diary-posts',
        body: { sectionId, text: text.trim(), mediaIds },
        success: 'Posted to diary — guardians notified',
      })
      setText('')
      setFiles([])
      onPosted?.()
    } catch { /* toast handled by useAct */ } finally {
      setPosting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <Field label="Class / Section" style={{ margin: 0 }}>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 9, fontSize: 13 }}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.className} — {s.name}</option>)}
          </select>
        </Field>
      </div>
      <textarea
        placeholder="Share an update, activity, or milestone…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 10, resize: 'vertical', minHeight: 70, fontFamily: 'inherit', fontSize: 14 }}
      />
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {files.map((f, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={URL.createObjectURL(f)} alt="" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--berry)', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer' }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <input type="file" ref={fileRef} hidden multiple accept="image/*,video/*" onChange={(e) => setFiles([...files, ...e.target.files])} />
        <button className="btn sm ghost" onClick={() => fileRef.current.click()}><Camera size={14} /> Photos</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={post} disabled={posting || !text.trim()}>
          <Send size={14} /> {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}

function CommentBox({ postId, onCommented }) {
  const [text, setText] = useState('')
  const act = useAct(['/diary-posts'])
  return (
    <form style={{ display: 'flex', gap: 6, marginTop: 8 }} onSubmit={(e) => {
      e.preventDefault()
      if (!text.trim()) return
      act.mutate({ path: `/diary-posts/${postId}/comments`, body: { text: text.trim() } }, { onSuccess: () => { setText(''); onCommented?.() } })
    }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" style={{ flex: 1, padding: '7px 10px', border: '1.5px solid var(--line)', borderRadius: 9, fontSize: 13 }} />
      <button className="btn sm" type="submit"><Send size={12} /></button>
    </form>
  )
}

function FeedCard({ post, onRefresh }) {
  const { user } = useStore()
  const act = useAct(['/diary-posts'])
  const [showComments, setShowComments] = useState(false)

  return (
    <div className="feed-card">
      <div className="feed-head">
        <span className="avatar plum">{initials(post.authorName)}</span>
        <div style={{ flex: 1 }}>
          <b>{post.authorName}</b>
          <div className="muted">{fmtDateTime(post.publishedAt)}</div>
        </div>
        {post.authorId === user.id && (
          <button className="btn sm ghost" onClick={() => act.mutate({ method: 'del', path: `/diary-posts/${post.id}`, success: 'Deleted' }, { onSuccess: onRefresh })}><Trash2 size={13} /></button>
        )}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{post.text}</div>
      {post.mediaIds?.length > 0 && (
        <div className="feed-media">
          {post.mediaIds.map((id) => <img key={id} src={mediaUrl(id)} alt="" />)}
        </div>
      )}
      <div className="feed-actions">
        <button className={post.likedByMe ? 'on' : ''} onClick={() => act.mutate({ path: `/diary-posts/${post.id}/like` }, { onSuccess: onRefresh })}>
          <Heart size={14} fill={post.likedByMe ? 'currentColor' : 'none'} /> {post.likeCount || ''}
        </button>
        <button onClick={() => setShowComments(!showComments)}>
          <MessageCircle size={14} /> {post.comments?.length || ''}
        </button>
      </div>
      {showComments && (
        <div style={{ marginTop: 8 }}>
          {post.comments?.map((c) => (
            <div key={c.id} style={{ fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f4efe6' }}>
              <b>{c.byName}</b> <span className="muted">{fmtDateTime(c.createdAt)}</span>
              <div>{c.text}</div>
            </div>
          ))}
          <CommentBox postId={post.id} onCommented={onRefresh} />
        </div>
      )}
    </div>
  )
}

export default function DiaryFeed() {
  const { data: sections = [] } = useGet('/sections')
  const enriched = sections.map((s) => {
    const cls = s._className || ''
    return { ...s, className: cls }
  })
  const { data: classes = [] } = useGet('/classes')
  const secs = sections.map((s) => ({ ...s, className: classes.find((c) => c.id === s.classId)?.name || '' }))
  const [sectionFilter, setSectionFilter] = useState('')
  const path = sectionFilter ? `/diary-posts?sectionId=${sectionFilter}` : '/diary-posts'
  const { data: posts = [], isLoading, refetch } = useGet(path)

  return (
    <div>
      <div className="page-head">
        <h1>Diary / Activity Feed</h1>
        <div className="spacer" />
        <div className="filters">
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="">All sections</option>
            {secs.map((s) => <option key={s.id} value={s.id}>{s.className} — {s.name}</option>)}
          </select>
        </div>
      </div>
      <Composer sections={secs} onPosted={refetch} />
      {isLoading && <Spinner />}
      {!isLoading && posts.length === 0 && <Empty emoji="📖" text="No diary posts yet — compose one above!" />}
      {posts.map((p) => <FeedCard key={p.id} post={p} onRefresh={refetch} />)}
    </div>
  )
}
