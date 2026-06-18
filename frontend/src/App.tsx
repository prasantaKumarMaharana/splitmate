import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Navbar from './components/Navbar'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import GroupPage from './pages/GroupPage'
import NewGroupPage from './pages/NewGroupPage'
import { Loader2 } from 'lucide-react'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-brand-500" size={32} />
      </div>
    )
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main>{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/" element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/groups/new" element={
            <ProtectedRoute>
              <AppLayout>
                <NewGroupPage />
              </AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/groups/:groupId" element={
            <ProtectedRoute>
              <AppLayout>
                <GroupPage />
              </AppLayout>
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
