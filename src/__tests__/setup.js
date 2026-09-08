import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// jsdom ships neither of these and Mantine uses both.
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub
window.scrollTo = window.scrollTo || vi.fn()

// zustand's persist middleware writes the auth store to localStorage. This jsdom
// build exposes the object but not a usable setItem (it warns about
// `--localstorage-file` at startup), so seeding a signed-in user in a test threw
// `storage.setItem is not a function` and every screen failed to render.
const memory = new Map()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
    clear: () => memory.clear(),
    key: (i) => [...memory.keys()][i] ?? null,
    get length() { return memory.size },
  },
})
