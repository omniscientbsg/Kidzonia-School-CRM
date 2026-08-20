import { Download, FileText } from 'lucide-react'
import { useGet, fmtDate } from '../../api/hooks'
import { mediaUrl } from '../../api/client'
import { Spinner, Empty } from '../../components/ui'

export default function ParentWorksheets() {
  const { data: resources = [], isLoading } = useGet('/parent/worksheets')

  if (isLoading) return <Spinner />

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>Worksheets</h2>
      {resources.length === 0 && <Empty emoji="📄" text="No worksheets available" />}
      {resources.map((r) => (
        <div className="card" key={r.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--sky-soft)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <FileText size={18} color="var(--sky)" />
            </div>
            <div style={{ flex: 1 }}>
              <b>{r.title}</b>
              {r.description && <div className="muted">{r.description}</div>}
              <div className="muted">{fmtDate(r.publishedAt)}</div>
            </div>
            {r.mediaId && (
              <a href={mediaUrl(r.mediaId)} download className="btn sm subtle">
                <Download size={13} />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
