import { Router } from 'express'
import { list, find, insert } from '../db.js'
import { requireAuth, staffOnly } from '../auth.js'
// files go through the storage driver, never straight to the filesystem
import { storage, uploader as upload } from '../storage/index.js'

const router = Router()
router.use(requireAuth)

router.post('/media', staffOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' })
  let studentIds = []
  try {
    studentIds = req.body.studentIds ? JSON.parse(req.body.studentIds) : []
  } catch {
    /* ignore malformed tag list */
  }
  const located = storage.locate(req.file)
  const asset = insert('mediaAssets', {
    branchId: req.scope.branchId || req.body.branchId || null,
    filename: req.file.originalname || req.file.filename,
    mimetype: req.file.mimetype,
    size: located.bytes,
    path: located.path,
    driver: storage.name,
    studentIds,
  }, req.user.id)
  res.status(201).json(asset)
})

// consent-gated file access: parents may only open media that is either
// untagged class media for their child's context, or tagged with their child
// AND covered by a granted media_share consent for that guardian+child.
export function parentCanSeeMedia(user, scope, asset) {
  if (!asset.studentIds || asset.studentIds.length === 0) return true
  const mine = asset.studentIds.filter((id) => scope.studentIds.includes(id))
  if (!mine.length) return false
  return mine.some((studentId) =>
    list('consents', { guardianId: user.guardianId, studentId, type: 'media_share' })[0]?.granted
  )
}

router.get('/media/:id/file', (req, res) => {
  const asset = find('mediaAssets', req.params.id)
  if (!asset) return res.status(404).json({ error: 'Not found' })
  if (req.user.role === 'parent') {
    if (!parentCanSeeMedia(req.user, req.scope, asset)) {
      return res.status(403).json({ error: 'Media not shared — consent required' })
    }
  } else if (req.scope.branchId && asset.branchId && asset.branchId !== req.scope.branchId) {
    return res.status(404).json({ error: 'Not found' })
  }
  if (!storage.exists(asset.path)) return res.status(410).json({ error: 'File missing' })
  res.setHeader('content-type', asset.mimetype)
  res.setHeader('content-disposition', `inline; filename="${asset.filename}"`)
  storage.stream(asset.path).pipe(res)
})

export default router
