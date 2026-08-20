import { useState, useRef } from 'react'
import { Plus, Image } from 'lucide-react'
import { useGet, useAct, fmtDate } from '../../api/hooks'
import { api, mediaUrl } from '../../api/client'
import { Spinner, Empty, Field, Modal } from '../../components/ui'

function CreateAlbumModal({ sections, onClose }) {
  const act = useAct(['/albums'])
  const [title, setTitle] = useState('')
  const [sectionId, setSectionId] = useState(sections[0]?.id || '')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  async function create() {
    if (!title.trim()) return
    setUploading(true)
    try {
      const mediaIds = []
      for (const f of files) {
        const fd = new FormData()
        fd.append('file', f)
        const asset = await api.upload('/media', fd)
        mediaIds.push(asset.id)
      }
      await act.mutateAsync({
        path: '/albums',
        body: { title: title.trim(), sectionId, mediaIds },
        success: 'Album created',
      })
      onClose()
    } catch { /* handled */ } finally {
      setUploading(false)
    }
  }

  return (
    <Modal title="New album" onClose={onClose}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sports Day 2026" autoFocus /></Field>
      <Field label="Section">
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.className} — {s.name}</option>)}
        </select>
      </Field>
      <input type="file" ref={fileRef} hidden multiple accept="image/*" onChange={(e) => setFiles([...files, ...e.target.files])} />
      <button className="btn sm ghost" onClick={() => fileRef.current.click()} style={{ marginBottom: 10 }}>
        <Image size={14} /> Add photos ({files.length})
      </button>
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {files.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8 }} />)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!title.trim() || uploading} onClick={create}>
          {uploading ? 'Uploading…' : 'Create album'}
        </button>
      </div>
    </Modal>
  )
}

export default function Albums() {
  const { data: albums = [], isLoading } = useGet('/albums')
  const { data: sections = [] } = useGet('/sections')
  const { data: classes = [] } = useGet('/classes')
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState(null)

  const secs = sections.map((s) => ({ ...s, className: classes.find((c) => c.id === s.classId)?.name || '' }))

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head">
        <h1>Albums</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> New album</button>
      </div>

      {albums.length === 0 && <Empty emoji="📸" text="No albums yet" />}
      <div className="grid-3">
        {albums.map((a) => (
          <div key={a.id} className="card" style={{ cursor: 'pointer', padding: 0, overflow: 'hidden' }} onClick={() => setSelected(a)}>
            {a.mediaIds?.length > 0 ? (
              <img src={mediaUrl(a.mediaIds[0])} alt="" style={{ width: '100%', height: 140, objectFit: 'cover' }} />
            ) : (
              <div style={{ height: 140, background: 'var(--marmalade-soft)', display: 'grid', placeItems: 'center', fontSize: 40 }}>📸</div>
            )}
            <div style={{ padding: '10px 14px' }}>
              <b>{a.title}</b>
              <div className="muted">{a.mediaIds?.length || 0} photos · {fmtDate(a.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)} wide>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(selected.mediaIds || []).map((id) => (
              <img key={id} src={mediaUrl(id)} alt="" style={{ width: 150, height: 150, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
            ))}
          </div>
          {(!selected.mediaIds || selected.mediaIds.length === 0) && <Empty emoji="📷" text="No photos in this album" />}
        </Modal>
      )}
      {creating && <CreateAlbumModal sections={secs} onClose={() => setCreating(false)} />}
    </div>
  )
}
