import express from 'express'
import cors from 'cors'
import { initDb } from './db.js'
import authRoutes from './routes/auth.routes.js'
import coreRoutes from './routes/core.routes.js'
import crmRoutes from './routes/crm.routes.js'
import admissionsRoutes from './routes/admissions.routes.js'
import studentsRoutes from './routes/students.routes.js'
import feesRoutes, { webhookRouter } from './routes/fees.routes.js'
import dailyRoutes from './routes/daily.routes.js'
import mediaRoutes from './routes/media.routes.js'

export function createApp() {
  initDb()
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', webhookRouter)
  app.use('/api', authRoutes)
  app.use('/api', coreRoutes)
  app.use('/api', crmRoutes)
  app.use('/api', admissionsRoutes)
  app.use('/api', studentsRoutes)
  app.use('/api', feesRoutes)
  app.use('/api', dailyRoutes)
  app.use('/api', mediaRoutes)

  return app
}
