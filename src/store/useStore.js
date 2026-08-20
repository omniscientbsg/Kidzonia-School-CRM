import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      activeChildId: null, // parent portal child switcher
      activeSessionId: null, // Setup: global active academic session (year) switcher
      login: (token, user) => set({ token, user, activeChildId: null, activeSessionId: null }),
      logout: () => set({ token: null, user: null, activeChildId: null, activeSessionId: null }),
      setActiveChild: (id) => set({ activeChildId: id }),
      setActiveSession: (id) => set({ activeSessionId: id }),
    }),
    { name: 'school-crm-auth' }
  )
)
