import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from './client'

export function useGet(path, opts = {}) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api.get(path),
    enabled: opts.enabled !== false,
    refetchInterval: opts.poll || false,
  })
}

// mutation that invalidates the given path prefixes and toasts errors
export function useAct(invalidate = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ method = 'post', path, body }) => api[method](path, body),
    onSuccess: (_data, vars) => {
      for (const prefix of [...invalidate, ...(vars.invalidate || [])]) {
        qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(prefix) })
      }
      if (vars.success) toast.success(vars.success)
    },
    onError: (err) => toast.error(err.message),
  })
}

export const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
export const todayISO = () => new Date().toISOString().slice(0, 10)
export const initials = (name = '') => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
