import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { groupsAPI } from '../lib/api'
import { ChevronLeft, Loader2 } from 'lucide-react'

export default function NewGroupPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Group name is required'); return }
    setLoading(true)
    setError('')
    try {
      const { data } = await groupsAPI.create(name.trim())
      navigate(`/groups/${data.id}`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create group')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <button onClick={() => navigate('/')} className="btn-ghost text-sm mb-6 -ml-1">
        <ChevronLeft size={16} /> Back
      </button>

      <h1 className="text-2xl font-semibold text-white mb-1">New group</h1>
      <p className="text-muted text-sm mb-6">Create a group to start splitting expenses.</p>

      <div className="card">
        {error && (
          <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Group name</label>
            <input
              className="input"
              placeholder="Goa Trip, Flatmates, Weekend Hike..."
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading && <Loader2 size={16} className="animate-spin" />}
            Create group
          </button>
        </form>
      </div>
    </div>
  )
}
