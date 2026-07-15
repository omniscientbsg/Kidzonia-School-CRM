import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      activeChildId: null, // parent portal child switcher
      login: (token, user) => set({ token, user, activeChildId: null }),
      logout: () => set({ token: null, user: null, activeChildId: null }),
      setActiveChild: (id) => set({ activeChildId: id }),
    }),
    { name: 'school-crm-auth' }
  )
)
