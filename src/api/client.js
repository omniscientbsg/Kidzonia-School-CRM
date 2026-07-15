import { useStore } from '../store/useStore'

async function request(method, path, body, isForm = false) {
  const { token, logout } = useStore.getState()
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json'
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  if (res.status === 401 && token) {
    logout()
    throw new Error('Session expired — please log in again')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => request('POST', path, formData, true),
}

export function mediaUrl(id) {
  const { token } = useStore.getState()
  return `/api/media/${id}/file?jwt=${token || ''}`
}
