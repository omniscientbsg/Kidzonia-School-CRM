import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 4020
app.listen(PORT, () => console.log(`School CRM API on http://localhost:${PORT}`))
