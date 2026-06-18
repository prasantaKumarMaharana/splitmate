import { useState } from 'react'
import { expensesAPI } from '../lib/api'
import { rupeesToPaise, paiseToRupees } from '../lib/utils'
import { X, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  groupId: string
  members: Array<{ id: string; name: string; email: string }>
  expense?: any
  onClose: () => void
  onSaved: () => void
}

export default function ExpenseForm({ groupId, members, expense, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const isEdit = !!expense

  const [description, setDescription] = useState(expense?.description || '')
  const [amountRupees, setAmountRupees] = useState(expense ? paiseToRupees(expense.amount_paise).toString() : '')
  const [paidBy, setPaidBy] = useState(expense?.paid_by || user?.id || '')
  const [splitType, setSplitType] = useState<'equal' | 'custom'>(expense?.split_type || 'equal')
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    expense?.splits?.map((s: any) => s.user_id) || members.map(m => m.id)
  )
  const [customShares, setCustomShares] = useState<Record<string, string>>(() => {
    if (expense?.splits) {
      return Object.fromEntries(
        expense.splits.map((s: any) => [s.user_id, paiseToRupees(s.share_paise).toString()])
      )
    }
    return Object.fromEntries(members.map(m => [m.id, '']))
  })

  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [loading, setLoading] = useState(false)

  const totalPaise = rupeesToPaise(parseFloat(amountRupees) || 0)

  // Compute sum of custom shares
  const customSum = Object.values(customShares).reduce(
    (acc, v) => acc + rupeesToPaise(parseFloat(v) || 0), 0
  )

  const toggleMember = (id: string) => {
    setSelectedMembers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setFieldError('')

    if (!description.trim()) { setError('Description is required'); return }
    if (totalPaise <= 0) { setError('Amount must be positive'); return }
    if (splitType === 'equal' && selectedMembers.length === 0) {
      setError('Select at least one member to split with'); return
    }
    if (splitType === 'custom' && customSum !== totalPaise) {
      setFieldError(`Shares add up to ₹${(customSum/100).toFixed(2)}, expense is ₹${(totalPaise/100).toFixed(2)}`)
      return
    }

    const payload: any = {
      description: description.trim(),
      amount_paise: totalPaise,
      paid_by: paidBy,
      split_type: splitType,
    }

    if (splitType === 'equal') {
      payload.split_member_ids = selectedMembers
    } else {
      payload.custom_splits = Object.entries(customShares)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([user_id, v]) => ({
          user_id,
          share_paise: rupeesToPaise(parseFloat(v)),
        }))
    }

    setLoading(true)
    try {
      if (isEdit) {
        await expensesAPI.update(groupId, expense.id, payload)
      } else {
        await expensesAPI.create(groupId, payload)
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save expense')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-panel border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-semibold text-white">{isEdit ? 'Edit expense' : 'Add expense'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="label">Description</label>
            <input
              className="input"
              placeholder="Hotel, dinner, fuel..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Amount (₹)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input"
              placeholder="0.00"
              value={amountRupees}
              onChange={e => setAmountRupees(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Paid by</label>
            <select
              className="input"
              value={paidBy}
              onChange={e => setPaidBy(e.target.value)}
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Split type</label>
            <div className="flex gap-2">
              {(['equal', 'custom'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSplitType(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    splitType === t
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface border border-border text-muted hover:text-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {splitType === 'equal' && (
            <div>
              <label className="label">Split among</label>
              <div className="space-y-2">
                {members.map(m => (
                  <label key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-border/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(m.id)}
                      onChange={() => toggleMember(m.id)}
                      className="accent-brand-500"
                    />
                    <span className="text-sm text-gray-300">{m.name}</span>
                    {selectedMembers.includes(m.id) && selectedMembers.length > 0 && totalPaise > 0 && (
                      <span className="ml-auto text-xs text-muted font-mono">
                        ≈ ₹{(totalPaise / selectedMembers.length / 100).toFixed(2)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {splitType === 'custom' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label !mb-0">Custom amounts (₹)</label>
                {fieldError && <span className="text-red-400 text-xs">{fieldError}</span>}
              </div>
              <div className="space-y-2">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-3">
                    <span className="text-sm text-gray-300 w-32 truncate">{m.name}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={`input flex-1 ${fieldError ? 'border-red-500' : ''}`}
                      placeholder="0.00"
                      value={customShares[m.id] || ''}
                      onChange={e => setCustomShares(prev => ({ ...prev, [m.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className={`text-xs mt-2 flex justify-between ${
                customSum === totalPaise ? 'text-green-400' : 'text-yellow-400'
              }`}>
                <span>Total assigned: ₹{(customSum/100).toFixed(2)}</span>
                <span>Expense: ₹{(totalPaise/100).toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Add expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
