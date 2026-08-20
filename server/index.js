import { createApp } from './app.js'
import { startScheduler } from './tasks/scheduler.js'

const PORT = process.env.PORT || 4020
createApp().listen(PORT, () => {
  console.log(`School CRM API on http://localhost:${PORT}`)
  // Started here rather than in createApp() so the test suite (which builds the
  // app directly) never spawns background timers.
  startScheduler()
})
