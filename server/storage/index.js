// Attachment storage abstraction.
//
// Everything that persists an uploaded file goes through a driver, so moving to
// S3/GCS/Azure is one new driver and one env var — no route or task code
// changes. Today there is exactly one driver: `local`, which writes to
// server/uploads/ and streams back through the API.
//
// MOCK/DEV ONLY. The local driver has no redundancy, no lifecycle rules, no
// virus scanning, no signed URLs (access is authorised per request instead),
// and it does not survive a container rebuild. Swap the driver before this
// carries anything a parent would mind losing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024

const localDriver = {
  name: 'local',

  // multer storage engine — the only place a filename is invented
  engine: () => multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOADS, { recursive: true })
      cb(null, UPLOADS)
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`),
  }),

  // what gets recorded on the mediaAssets row; a cloud driver would return a
  // key/bucket pair here instead of a bare filename
  locate: (file) => ({ path: file.filename, bytes: file.size }),

  exists: (key) => fs.existsSync(path.join(UPLOADS, key)),

  stream: (key) => fs.createReadStream(path.join(UPLOADS, key)),

  remove: (key) => {
    try {
      fs.unlinkSync(path.join(UPLOADS, key))
      return true
    } catch {
      return false
    }
  },
}

const DRIVERS = { local: localDriver }

export const storage = DRIVERS[process.env.STORAGE_DRIVER || 'local'] || localDriver

export const uploader = multer({ storage: storage.engine(), limits: { fileSize: MAX_UPLOAD_BYTES } })
