import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb } from './db.js'
import { requireAuth } from './auth.js'
import { taskGate } from './tasks/gate.js'
import { subscribeVerification } from './tasks/verify.js'
import { registerLocks } from './tasks/lock.js'
import authRoutes from './routes/auth.routes.js'
import coreRoutes from './routes/core.routes.js'
import crmRoutes from './routes/crm.routes.js'
import admissionsRoutes from './routes/admissions.routes.js'
import studentsRoutes from './routes/students.routes.js'
import feesRoutes, { webhookRouter } from './routes/fees.routes.js'
import feesConfigRoutes from './routes/fees.config.routes.js'
import feesOpsRoutes from './routes/fees.ops.routes.js'
import dailyRoutes from './routes/daily.routes.js'
import mediaRoutes from './routes/media.routes.js'
import commsRoutes from './routes/comms.routes.js'
import dashboardsRoutes from './routes/dashboards.routes.js'
import setupRoutes from './routes/setup.routes.js'
import orgRoutes from './routes/org.routes.js'
import tasksRoutes from './routes/tasks.routes.js'

export function createApp() {
  initDb()
  // Subscribe the task engine to every module signal that publishes a push
  // topic. Read off the descriptors, so a new module needs no line here.
  subscribeVerification()
  // and answer capabilities/taskLock.check() for every module that asks
  registerLocks()
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', webhookRouter)

  // Mandatory-task gate: refuses writes elsewhere in the API while blocking
  // work from an earlier day is still open. Mounted before the feature routers
  // so no endpoint can be added past it by accident.
  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    if (/^\/auth\//.test(req.path)) return next()
    requireAuth(req, res, () => taskGate(req, res, next))
  })

  app.use('/api', authRoutes)
  app.use('/api', coreRoutes)
  app.use('/api', crmRoutes)
  app.use('/api', admissionsRoutes)
  app.use('/api', studentsRoutes)
  app.use('/api', feesRoutes)
  app.use('/api', feesConfigRoutes)
  app.use('/api', feesOpsRoutes)
  app.use('/api', dailyRoutes)
  app.use('/api', mediaRoutes)
  app.use('/api', commsRoutes)
  app.use('/api', dashboardsRoutes)
  app.use('/api', setupRoutes)
  app.use('/api', orgRoutes)
  app.use('/api', tasksRoutes)

  // ---- production: one service serves the API and the built UI ----
  //
  // Serving both from the same origin means there is no CORS to configure, no
  // second host to keep alive, and no API base URL to thread through the
  // client — /api works in production for exactly the reason it works behind
  // the Vite dev proxy. In development this directory does not exist and the
  // block is skipped.
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    // SPA fallback: anything that is not /api and not a real file is a client
    // route, so hand back index.html and let React Router decide. Never cached,
    // or a deploy would leave browsers holding the previous build's script tags.
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (req.method !== 'GET') return next()
      res.set('Cache-Control', 'no-store').sendFile(path.join(dist, 'index.html'))
    })
  }

  return app
}
