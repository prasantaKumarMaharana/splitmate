import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

// On 401: transparently refresh access token and retry original request
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          })
        })
      }

      isRefreshing = true
      const refreshToken = localStorage.getItem('refresh_token')
      if (!refreshToken) {
        localStorage.clear()
        window.location.href = '/login'
        return Promise.reject(error)
      }

      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        })
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)

        refreshQueue.forEach((cb) => cb(data.access_token))
        refreshQueue = []
        isRefreshing = false

        original.headers.Authorization = `Bearer ${data.access_token}`
        return api(original)
      } catch {
        localStorage.clear()
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  }
)

// In dev, Vite proxies /ws → ws://localhost:8000/ws (no CORS issues)
// In prod, set VITE_WS_URL explicitly or derive from API URL
export const WS_URL = import.meta.env.VITE_WS_URL ||
  (BASE_URL === 'http://localhost:8000'
    ? `ws://localhost:8000`
    : BASE_URL.replace(/^http/, 'ws'))

// ── Auth ────────────────────────────────────────────────────────────────────
export const authAPI = {
  signup: (data: { name: string; email: string; password: string }) =>
    api.post('/auth/signup', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  logout: (refresh_token: string) =>
    api.post('/auth/logout', { refresh_token }),
  me: () => api.get('/auth/me'),
}

// ── Groups ───────────────────────────────────────────────────────────────────
export const groupsAPI = {
  list: () => api.get('/groups'),
  create: (name: string) => api.post('/groups', { name }),
  get: (id: string) => api.get(`/groups/${id}`),
  delete: (id: string) => api.delete(`/groups/${id}`),
  addMember: (groupId: string, email: string) =>
    api.post(`/groups/${groupId}/members`, { email }),
  removeMember: (groupId: string, userId: string) =>
    api.delete(`/groups/${groupId}/members/${userId}`),
}

// ── Expenses ─────────────────────────────────────────────────────────────────
export const expensesAPI = {
  list: (groupId: string, page = 1, sortBy = 'date', order = 'desc') =>
    api.get(`/groups/${groupId}/expenses`, { params: { page, sort_by: sortBy, order } }),
  create: (groupId: string, data: any) =>
    api.post(`/groups/${groupId}/expenses`, data),
  update: (groupId: string, expenseId: string, data: any) =>
    api.put(`/groups/${groupId}/expenses/${expenseId}`, data),
  delete: (groupId: string, expenseId: string) =>
    api.delete(`/groups/${groupId}/expenses/${expenseId}`),
}

// ── Balances & Settlements ────────────────────────────────────────────────────
export const balancesAPI = {
  group: (groupId: string) => api.get(`/groups/${groupId}/balances`),
  overall: () => api.get('/users/me/balance'),
  settle: (groupId: string, payee_id: string, amount_paise: number) =>
    api.post(`/groups/${groupId}/settlements`, { payee_id, amount_paise }),
}

// ── Activity ──────────────────────────────────────────────────────────────────
export const activityAPI = {
  group: (groupId: string) => api.get(`/groups/${groupId}/activity`),
  personal: () => api.get('/users/me/activity'),
}
