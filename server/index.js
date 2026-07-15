import { createApp } from './app.js'

const PORT = process.env.PORT || 4020
createApp().listen(PORT, () => console.log(`School CRM API on http://localhost:${PORT}`))
