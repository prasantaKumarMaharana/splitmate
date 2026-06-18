import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { SplitSquareVertical, Loader2 } from 'lucide-react'
import axios from 'axios'

type Mode = 'login' | 'signup'

export default function AuthPage({ mode }: { mode: Mode }) {
  const { login, signup } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setFieldErrors({})

    // Client-side validation
    const fe: Record<string, string> = {}
    if (mode === 'signup' && !name.trim()) fe.name = 'Name is required'
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) fe.email = 'Valid email required'
    if (password.length < 8) fe.password = 'Password must be at least 8 characters'
    if (Object.keys(fe).length) { setFieldErrors(fe); return }

    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await signup(name, email, password)
      }
      navigate('/')
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail
        if (typeof detail === 'string') setError(detail)
        else if (Array.isArray(detail)) {
          const msgs = detail.map((d: any) => d.msg).join(', ')
          setError(msgs)
        } else setError('Something went wrong')
      } else {
        setError('Network error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
            <SplitSquareVertical size={20} className="text-white" />
          </div>
          <span className="text-xl font-semibold text-white">SplitMate</span>
        </div>

        <div className="card">
          <h1 className="text-xl font-semibold text-white mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="text-muted text-sm mb-6">
            {mode === 'login'
              ? 'Sign in to see your shared expenses'
              : 'Start splitting expenses with friends'}
          </p>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-3 text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">Name</label>
                <input
                  className={`input ${fieldErrors.name ? 'border-red-500' : ''}`}
                  placeholder="Priya Sharma"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                {fieldErrors.name && <p className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>}
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className={`input ${fieldErrors.email ? 'border-red-500' : ''}`}
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              {fieldErrors.email && <p className="text-red-400 text-xs mt-1">{fieldErrors.email}</p>}
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className={`input ${fieldErrors.password ? 'border-red-500' : ''}`}
                placeholder={mode === 'signup' ? 'Min 8 chars, 1 uppercase, 1 number, 1 special' : '••••••••'}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              {fieldErrors.password && <p className="text-red-400 text-xs mt-1">{fieldErrors.password}</p>}
              {mode === 'signup' && !fieldErrors.password && (
                <p className="text-muted text-xs mt-1">Requires uppercase, number, and special character</p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading && <Loader2 size={16} className="animate-spin" />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-muted text-sm mt-4">
            {mode === 'login' ? (
              <>Don't have an account?{' '}
                <Link to="/signup" className="text-brand-500 hover:text-brand-400">Sign up</Link>
              </>
            ) : (
              <>Already have an account?{' '}
                <Link to="/login" className="text-brand-500 hover:text-brand-400">Sign in</Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
