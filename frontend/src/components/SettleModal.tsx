import { useState } from 'react'
import { balancesAPI, groupsAPI } from '../lib/api'
import { formatAmount } from '../lib/utils'
import { X, Loader2 } from 'lucide-react'

// ── Settle Modal ─────────────────────────────────────────────────────────────

interface SettleProps {
  groupId: string
  suggestions: Array<{ from_user_id: string; to_user_id: string; to_name: string; amount_paise: number }>
  currentUserId: string
  onClose: () => void
  onSaved: () => void
}

export function SettleModal({ groupId, suggestions, currentUserId, onClose, onSaved }: SettleProps) {
  const mySuggestions = suggestions.filter(s => s.from_user_id === currentUserId)
  const [selected, setSelected] = useState(mySuggestions[0] || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSettle = async () => {
    if (!selected) return
    setLoading(true)
    setError('')
    try {
      await balancesAPI.settle(groupId, selected.to_user_id, selected.amount_paise)
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Settlement failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-panel border border-border rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-semibold text-white">Settle up</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}
          {mySuggestions.length === 0 ? (
            <p className="text-muted text-sm text-center py-4">No outstanding balances to settle.</p>
          ) : (
            <>
              <p className="text-sm text-muted">Select a payment to record:</p>
              <div className="space-y-2">
                {mySuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setSelected(s)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      selected === s
                        ? 'border-brand-500 bg-brand-900/20'
                        : 'border-border hover:border-gray-500'
                    }`}
                  >
                    <p className="text-sm text-gray-300">
                      Pay <span className="font-medium text-white">{s.to_name}</span>
                    </p>
                    <p className="text-lg font-semibold text-brand-400 mt-1">{formatAmount(s.amount_paise)}</p>
                  </button>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
                <button onClick={handleSettle} className="btn-primary flex-1" disabled={loading || !selected}>
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  Record payment
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettleModal

// ── Add Member Modal ──────────────────────────────────────────────────────────

interface AddMemberProps {
  groupId: string
  onClose: () => void
  onSaved: () => void
}

export function AddMemberModal({ groupId, onClose, onSaved }: AddMemberProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await groupsAPI.addMember(groupId, email.trim())
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add member')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-panel border border-border rounded-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-semibold text-white">Add member</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <form onSubmit={handleAdd} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="label">Email address</label>
            <input
              type="email"
              className="input"
              placeholder="friend@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted mt-1">They must already have a SplitMate account.</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              Add member
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
