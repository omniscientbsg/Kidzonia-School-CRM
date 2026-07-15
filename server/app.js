import express from 'express'
import cors from 'cors'
import { initDb } from './db.js'
import authRoutes from './routes/auth.routes.js'
import coreRoutes from './routes/core.routes.js'
import crmRoutes from './routes/crm.routes.js'

export function createApp() {
  initDb()
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', authRoutes)
  app.use('/api', coreRoutes)
  app.use('/api', crmRoutes)

  return app
}
