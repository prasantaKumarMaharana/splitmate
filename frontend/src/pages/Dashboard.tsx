import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { balancesAPI, activityAPI, groupsAPI } from '../lib/api'
import { formatAmount, eventTypeLabel, formatDate } from '../lib/utils'
import { useWebSocket } from '../hooks/useWebSocket'
import {
  TrendingUp, TrendingDown, Wallet, Users, Activity, Plus, Loader2, AlertCircle
} from 'lucide-react'

interface OverallBalance {
  total_owed_paise: number
  total_you_owe_paise: number
  net_paise: number
  group_count: number
  most_owed_group_id: string | null
  most_owed_group_name: string | null
  most_owed_amount_paise: number
}

export default function Dashboard() {
  const [balance, setBalance] = useState<OverallBalance | null>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAll = async () => {
    try {
      const [balRes, actRes, grpRes] = await Promise.all([
        balancesAPI.overall(),
        activityAPI.personal(),
        groupsAPI.list(),
      ])
      setBalance(balRes.data)
      setActivity(actRes.data)
      setGroups(grpRes.data)
    } catch {
      setError('Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  useWebSocket({
    expense_added: fetchAll,
    expense_updated: fetchAll,
    expense_deleted: fetchAll,
    settlement_recorded: fetchAll,
    member_added: fetchAll,
  })

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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-muted text-sm mt-0.5">Your financial overview</p>
        </div>
        <Link to="/groups/new" className="btn-primary text-sm">
          <Plus size={16} /> New Group
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="You are owed"
          value={formatAmount(balance?.total_owed_paise || 0)}
          icon={<TrendingUp size={18} className="text-green-400" />}
          color="text-green-400"
        />
        <StatCard
          label="You owe"
          value={formatAmount(balance?.total_you_owe_paise || 0)}
          icon={<TrendingDown size={18} className="text-red-400" />}
          color="text-red-400"
        />
        <StatCard
          label="Net balance"
          value={formatAmount(balance?.net_paise || 0)}
          icon={<Wallet size={18} className="text-brand-500" />}
          color="text-white"
        />
        <StatCard
          label="Groups"
          value={String(balance?.group_count || 0)}
          icon={<Users size={18} className="text-purple-400" />}
          color="text-white"
        />
      </div>

      {balance?.most_owed_group_name && (
        <div className="card border-yellow-700/40 bg-yellow-900/10">
          <p className="text-sm text-yellow-400 font-medium">
            You owe the most in{' '}
            <Link to={`/groups/${balance.most_owed_group_id}`} className="underline hover:text-yellow-300">
              {balance.most_owed_group_name}
            </Link>
            {' '}— {formatAmount(balance.most_owed_amount_paise)}
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Users size={16} className="text-muted" /> Groups
            </h2>
            <Link to="/groups/new" className="text-brand-500 text-sm hover:text-brand-400">New</Link>
          </div>
          {groups.length === 0 ? (
            <p className="text-muted text-sm text-center py-6">No groups yet. Create one to get started!</p>
          ) : (
            <div className="space-y-2">
              {groups.map((g: any) => (
                <Link
                  key={g.id}
                  to={`/groups/${g.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-border transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{g.name}</p>
                    <p className="text-xs text-muted">{g.members.length} members</p>
                  </div>
                  <span className="text-xs text-muted">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
            <Activity size={16} className="text-muted" /> Recent Activity
          </h2>
          {activity.length === 0 ? (
            <p className="text-muted text-sm text-center py-6">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((a: any) => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center flex-shrink-0 text-xs font-medium text-gray-300">
                    {a.actor_name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-300">
                      <span className="font-medium text-white">{a.actor_name}</span>
                      {' '}{eventTypeLabel(a.event_type)}
                      {a.payload?.description && (
                        <span className="text-muted"> "{a.payload.description}"</span>
                      )}
                    </p>
                    <p className="text-muted text-xs">{formatDate(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: {
  label: string; value: string; icon: React.ReactNode; color: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-muted text-xs font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  )
}
