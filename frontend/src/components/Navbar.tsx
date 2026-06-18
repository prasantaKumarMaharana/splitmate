import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { SplitSquareVertical, LogOut } from 'lucide-react'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <nav className="border-b border-border bg-panel sticky top-0 z-40">
      <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
            <SplitSquareVertical size={16} className="text-white" />
          </div>
          <span className="font-semibold text-white">SplitMate</span>
        </Link>

        {user && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-900/50 border border-brand-700/50 flex items-center justify-center text-brand-400 text-sm font-medium">
              {user.name?.[0]?.toUpperCase()}
            </div>
            <span className="text-sm text-gray-400 hidden sm:block">{user.name}</span>
            <button onClick={handleLogout} className="btn-ghost p-2 text-muted" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
