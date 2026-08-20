// THE opt-in point. A module joins the task engine by adding one line here.
//
// Import order is the registration order, which is also the order the create
// task form lists modules in.
import { registerModule, resetRegistry, listModules } from './registry.js'
import attendance from './attendance.cap.js'
import daycare from './daycare.cap.js'
import tasksCap from './tasks.cap.js'
import activity from './activity.cap.js'
import parents from './parents.cap.js'

const DESCRIPTORS = [attendance, daycare, tasksCap, activity, parents]

let loaded = false

export function loadCapabilities({ force = false } = {}) {
  if (loaded && !force) return listModules()
  if (force) resetRegistry()
  for (const d of DESCRIPTORS) registerModule(d)
  loaded = true
  return listModules()
}

// Registering at import time means a malformed descriptor fails the boot, not
// the first task somebody tries to build on it.
loadCapabilities()

export * from './registry.js'
