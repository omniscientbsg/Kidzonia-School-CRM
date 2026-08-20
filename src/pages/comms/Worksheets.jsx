import { useState, useRef } from 'react'
import { Plus, Download, FileText } from 'lucide-react'
import { useGet, useAct, fmtDate } from '../../api/hooks'
import { api, mediaUrl } from '../../api/client'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'

function UploadModal({ onClose }) {
  const act = useAct(['/published-resources'])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  async function publish() {
    if (!title.trim() || !file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const asset = await api.upload('/media', fd)
      await act.mutateAsync({
        path: '/published-resources',
        body: { title: title.trim(), description, mediaId: asset.id },
        success: 'Worksheet published',
      })
      onClose()
    } catch { /* handled */ } finally {
      setUploading(false)
    }
  }

  return (
    <Modal title="Publish worksheet / resource" onClose={onClose}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. English worksheet Week 4" autoFocus /></Field>
      <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description…" /></Field>
      <input type="file" ref={fileRef} hidden onChange={(e) => setFile(e.target.files[0])} />
      <button className="btn sm ghost" onClick={() => fileRef.current.click()} style={{ marginBottom: 14 }}>
        <FileText size={14} /> {file ? file.name : 'Choose file'}
      </button>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!title.trim() || !file || uploading} onClick={publish}>
          {uploading ? 'Uploading…' : 'Publish'}
        </button>
      </div>
    </Modal>
  )
}

export default function Worksheets() {
  const { data: resources = [], isLoading } = useGet('/published-resources')
  const [uploading, setUploading] = useState(false)
  const act = useAct(['/published-resources'])

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head">
        <h1>Worksheets & Resources</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setUploading(true)}><Plus size={15} /> Publish</button>
      </div>

      {resources.length === 0 && <Empty emoji="📄" text="No worksheets published yet" />}
      <div className="card">
        {resources.map((r) => (
          <div key={r.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #f4efe6', alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--sky-soft)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <FileText size={18} color="var(--sky)" />
            </div>
            <div style={{ flex: 1 }}>
              <b>{r.title}</b>
              {r.description && <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{r.description}</div>}
              <div className="muted">{fmtDate(r.publishedAt)}</div>
            </div>
            {r.mediaId && (
              <a href={mediaUrl(r.mediaId)} download className="btn sm subtle">
                <Download size={13} /> Download
              </a>
            )}
            <button className="btn sm ghost" onClick={() => act.mutate({ method: 'del', path: `/published-resources/${r.id}`, success: 'Deleted' })}>Delete</button>
          </div>
        ))}
      </div>

      {uploading && <UploadModal onClose={() => setUploading(false)} />}
    </div>
  )
}
