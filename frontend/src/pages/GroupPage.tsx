import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { groupsAPI, expensesAPI, balancesAPI, activityAPI } from '../lib/api'
import { formatAmount, formatDate, eventTypeLabel } from '../lib/utils'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth } from '../contexts/AuthContext'
import ExpenseForm from '../components/ExpenseForm'
import SettleModal from '../components/SettleModal'
import AddMemberModal from '../components/AddMemberModal'
import {
  Plus, Trash2, Edit2, Users, ArrowRight, Activity,
  Loader2, AlertCircle, ChevronLeft, UserMinus, RefreshCw
} from 'lucide-react'

type Tab = 'expenses' | 'balances' | 'activity'

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [group, setGroup] = useState<any>(null)
  const [expenses, setExpenses] = useState<any[]>([])
  const [balances, setBalances] = useState<any>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('expenses')
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<any>(null)
  const [showSettle, setShowSettle] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [liveNotice, setLiveNotice] = useState('')

  const fetchGroup = useCallback(async () => {
    if (!groupId) return
    try {
      const [grpRes, expRes, balRes, actRes] = await Promise.all([
        groupsAPI.get(groupId),
        expensesAPI.list(groupId),
        balancesAPI.group(groupId),
        activityAPI.group(groupId),
      ])
      setGroup(grpRes.data)
      setExpenses(expRes.data.items)
      setBalances(balRes.data)
      setActivity(actRes.data)
    } catch {
      setError('Failed to load group')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { fetchGroup() }, [fetchGroup])

  const flash = (msg: string) => {
    setLiveNotice(msg)
    setTimeout(() => setLiveNotice(''), 4000)
  }

  useWebSocket({
    expense_added: (data) => {
      if (data.group_id !== groupId) return
      flash(`New expense added: "${data.expense?.description}"`)
      fetchGroup()
    },
    expense_updated: (data) => {
      if (data.group_id !== groupId) return
      flash('An expense was updated')
      fetchGroup()
    },
    expense_deleted: (data) => {
      if (data.group_id !== groupId) return
      flash('An expense was deleted')
      fetchGroup()
    },
    settlement_recorded: (data) => {
      if (data.group_id !== groupId) return
      flash(`${data.payer_name} paid ${data.payee_name} ${formatAmount(data.amount_paise)}`)
      fetchGroup()
    },
    member_added: (data) => {
      if (data.group_id !== groupId) return
      flash(`${data.user_name} joined the group`)
      fetchGroup()
    },
    member_removed: (data) => {
      if (data.group_id !== groupId) return
      fetchGroup()
    },
  })

  const handleDeleteExpense = async (expenseId: string) => {
    if (!confirm('Delete this expense?')) return
    try {
      await expensesAPI.delete(groupId!, expenseId)
      fetchGroup()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete')
    }
  }

  const handleRemoveMember = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from the group?`)) return
    try {
      await groupsAPI.removeMember(groupId!, userId)
      fetchGroup()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Cannot remove member')
    }
  }

  const handleDeleteGroup = async () => {
    if (!confirm('Delete this entire group? This cannot be undone.')) return
    try {
      await groupsAPI.delete(groupId!)
      navigate('/')
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete group')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-brand-500" size={32} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-8">
        <AlertCircle size={18} /> {error}
      </div>
    )
  }

  const isOwner = group?.owner_id === user?.id
  const myBalance = balances?.balances?.find((b: any) => b.user_id === user?.id)

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => navigate('/')} className="btn-ghost text-sm mb-3 -ml-1">
          <ChevronLeft size={16} /> Back
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">{group?.name}</h1>
            <p className="text-muted text-sm mt-0.5">{group?.members?.length} members</p>
          </div>
          <div className="flex gap-2">
            {isOwner && (
              <>
                <button onClick={() => setShowAddMember(true)} className="btn-secondary text-sm">
                  <Users size={14} /> Add member
                </button>
                <button onClick={handleDeleteGroup} className="btn-ghost text-red-400 text-sm">
                  Delete group
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Live notice banner */}
      {liveNotice && (
        <div className="bg-brand-900/30 border border-brand-700/50 text-brand-400 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> {liveNotice}
        </div>
      )}

      {/* My balance quick stat */}
      {myBalance && (
        <div className={`card border ${
          myBalance.net_paise > 0 ? 'border-green-700/40 bg-green-900/10' :
          myBalance.net_paise < 0 ? 'border-red-700/40 bg-red-900/10' :
          'border-border'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted font-medium uppercase tracking-wide">Your balance in this group</p>
              <p className={`text-2xl font-semibold mt-1 ${
                myBalance.net_paise > 0 ? 'text-green-400' :
                myBalance.net_paise < 0 ? 'text-red-400' :
                'text-gray-400'
              }`}>
                {myBalance.net_paise > 0 ? '+' : ''}{formatAmount(myBalance.net_paise)}
              </p>
              <p className="text-sm text-muted mt-0.5">
                {myBalance.net_paise > 0 ? 'Others owe you' :
                 myBalance.net_paise < 0 ? 'You owe others' : 'All settled up!'}
              </p>
            </div>
            {myBalance.net_paise < 0 && (
              <button className="btn-primary text-sm" onClick={() => setShowSettle(true)}>
                Settle up
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['expenses', 'balances', 'activity'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize -mb-px border-b-2 transition-colors ${
              tab === t
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-muted hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
        {tab === 'expenses' && (
          <button
            className="btn-primary text-sm ml-auto mb-2"
            onClick={() => { setEditingExpense(null); setShowExpenseForm(true) }}
          >
            <Plus size={14} /> Add expense
          </button>
        )}
      </div>

      {/* Expenses tab */}
      {tab === 'expenses' && (
        <div className="space-y-3">
          {expenses.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-muted mb-3">No expenses yet</p>
              <button className="btn-primary text-sm mx-auto" onClick={() => setShowExpenseForm(true)}>
                <Plus size={14} /> Add first expense
              </button>
            </div>
          ) : (
            expenses.map((e: any) => (
              <div key={e.id} className="card flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-white">{e.description}</p>
                    <span className="badge-neutral">{e.split_type}</span>
                  </div>
                  <p className="text-muted text-sm mt-1">
                    <span className="text-gray-300">{e.payer_name}</span> paid · {formatDate(e.date)}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {e.splits.map((s: any) => (
                      <span key={s.user_id} className="text-xs bg-border px-2 py-0.5 rounded-full text-gray-400">
                        {s.user_name}: {formatAmount(s.share_paise)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-semibold text-white">{formatAmount(e.amount_paise)}</p>
                  {(e.created_by === user?.id || isOwner) && (
                    <div className="flex gap-1 mt-2 justify-end">
                      <button
                        className="btn-ghost p-1.5"
                        onClick={() => { setEditingExpense(e); setShowExpenseForm(true) }}
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="btn-ghost p-1.5 text-red-400 hover:text-red-300"
                        onClick={() => handleDeleteExpense(e.id)}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Balances tab */}
      {tab === 'balances' && balances && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-medium text-white mb-4">Member Balances</h3>
            <div className="space-y-2">
              {balances.balances.map((b: any) => (
                <div key={b.user_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-sm font-medium text-gray-300">
                      {b.name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{b.name}</p>
                      {isOwner && b.user_id !== user?.id && b.net_paise === 0 && (
                        <button
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 mt-0.5"
                          onClick={() => handleRemoveMember(b.user_id, b.name)}
                        >
                          <UserMinus size={10} /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <span className={
                    b.net_paise > 0 ? 'text-green-400 font-medium' :
                    b.net_paise < 0 ? 'text-red-400 font-medium' :
                    'text-muted'
                  }>
                    {b.net_paise > 0 ? '+' : ''}{formatAmount(b.net_paise)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {balances.suggestions.length > 0 && (
            <div className="card">
              <h3 className="font-medium text-white mb-4">Settlement Suggestions</h3>
              <div className="space-y-3">
                {balances.suggestions.map((s: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-medium text-white">{s.from_name}</span>
                    <ArrowRight size={14} className="text-muted" />
                    <span className="font-medium text-white">{s.to_name}</span>
                    <span className="ml-auto font-semibold text-brand-400">{formatAmount(s.amount_paise)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity tab */}
      {tab === 'activity' && (
        <div className="card">
          <h3 className="font-medium text-white mb-4 flex items-center gap-2">
            <Activity size={16} className="text-muted" /> Activity Feed
          </h3>
          {activity.length === 0 ? (
            <p className="text-muted text-sm text-center py-8">No activity yet</p>
          ) : (
            <div className="space-y-4">
              {activity.map((a: any) => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center flex-shrink-0 text-xs font-medium text-gray-300">
                    {a.actor_name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-gray-300">
                      <span className="font-medium text-white">{a.actor_name}</span>
                      {' '}{eventTypeLabel(a.event_type)}
                      {a.payload?.description && (
                        <> — <span className="text-muted">"{a.payload.description}"</span></>
                      )}
                      {a.payload?.amount_paise && (
                        <> · <span className="text-brand-400">{formatAmount(a.payload.amount_paise)}</span></>
                      )}
                    </p>
                    <p className="text-muted text-xs mt-0.5">{formatDate(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showExpenseForm && (
        <ExpenseForm
          groupId={groupId!}
          members={group?.members || []}
          expense={editingExpense}
          onClose={() => { setShowExpenseForm(false); setEditingExpense(null) }}
          onSaved={fetchGroup}
        />
      )}

      {showSettle && (
        <SettleModal
          groupId={groupId!}
          suggestions={balances?.suggestions || []}
          currentUserId={user?.id || ''}
          onClose={() => setShowSettle(false)}
          onSaved={fetchGroup}
        />
      )}

      {showAddMember && (
        <AddMemberModal
          groupId={groupId!}
          onClose={() => setShowAddMember(false)}
          onSaved={fetchGroup}
        />
      )}
    </div>
  )
}
