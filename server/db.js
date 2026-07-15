import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { buildSeed } from './seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.SCHOOL_CRM_DB || path.join(__dirname, 'data', 'db.json')

export const COLLECTIONS = [
  'branches', 'academicYears', 'programs', 'classes', 'sections',
  'users', 'rolePermissions',
  'leads', 'leadActivities', 'followUpTasks',
  'applications', 'applicationDocuments',
  'families', 'guardians', 'guardianStudentLinks', 'students', 'enrolments',
  'attendanceRecords', 'leaveRequests',
  'feeHeads', 'feeStructures', 'invoices', 'payments', 'receipts',
  'discounts', 'refunds', 'ledgerEntries',
  'diaryPosts', 'diaryComments', 'dailyLogs', 'checkInOuts',
  'albums', 'mediaAssets', 'homework', 'consents',
  'announcements', 'announcementReads', 'chatThreads', 'messages',
  'events', 'eventRsvps', 'publishedResources',
  'notifications', 'notificationLog', 'auditLog',
]

let db = null

export function initDb() {
  if (db) return db
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  } else {
    db = buildSeed()
    persist()
  }
  for (const c of COLLECTIONS) if (!db[c]) db[c] = []
  if (!db._counters) db._counters = {}
  return db
}

export function getDb() {
  return initDb()
}

let saveTimer = null
export function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist()
  }, 50)
}

function persist() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

export const uid = () => crypto.randomUUID()

export function list(coll, where = null) {
  const rows = getDb()[coll].filter((r) => !r.deletedAt)
  if (!where) return rows
  if (typeof where === 'function') return rows.filter(where)
  return rows.filter((r) =>
    Object.entries(where).every(([k, v]) => v === undefined || r[k] === v)
  )
}

export function find(coll, id) {
  return getDb()[coll].find((r) => r.id === id && !r.deletedAt) || null
}

export function insert(coll, data, userId = null) {
  const now = new Date().toISOString()
  const row = {
    id: uid(),
    ...data,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    deletedAt: null,
  }
  getDb()[coll].push(row)
  save()
  return row
}

export function update(coll, id, patch, userId = null) {
  const row = find(coll, id)
  if (!row) return null
  Object.assign(row, patch, { updatedAt: new Date().toISOString(), updatedBy: userId })
  save()
  return row
}

export function softDelete(coll, id, userId = null) {
  const row = find(coll, id)
  if (!row) return null
  row.deletedAt = new Date().toISOString()
  row.updatedBy = userId
  save()
  return row
}

export function nextNumber(key) {
  const d = getDb()
  d._counters[key] = (d._counters[key] || 0) + 1
  save()
  return d._counters[key]
}
