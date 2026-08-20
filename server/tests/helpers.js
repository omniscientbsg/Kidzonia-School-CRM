import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// point the repository at a throwaway file BEFORE app/db are imported
const tmp = path.join(os.tmpdir(), `school-crm-test-${process.pid}-${Date.now()}.json`)
process.env.SCHOOL_CRM_DB = tmp

const { createApp } = await import('../app.js')

let server = null
let baseUrl = null

export async function startServer() {
  if (server) return baseUrl
  const app = createApp()
  await new Promise((resolve) => {
    server = app.listen(0, resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
  return baseUrl
}

export function stopServer() {
  if (server) server.close()
  server = null
  try {
    fs.unlinkSync(tmp)
  } catch {
    /* already gone */
  }
}

export function getBaseUrl() {
  return baseUrl
}

export async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, data }
}

// The seed ships a realistic board of demo tasks. Behavioural task tests want a
// clean slate. Cancelling the templates is not enough — cancelling deliberately
// KEEPS finished history, which then shows up in global roll-ups — so the
// fixture empties the collections directly (same process, same db singleton).
export async function clearSeededTasks() {
  const { getDb, save } = await import('../db.js')
  const db = getDb()
  for (const coll of ['tasks', 'taskInstances', 'taskApprovals', 'taskAttachments']) db[coll].length = 0
  save()
}

export async function login(email, password = 'password') {
  const { status, data } = await api('POST', '/api/auth/login', { body: { email, password } })
  if (status !== 200) throw new Error(`login failed for ${email}: ${status} ${JSON.stringify(data)}`)
  return data.token
}
