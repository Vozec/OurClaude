import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authApi } from './lib/api'
import Login from './components/Login'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Users from './components/Users'
import Pools from './components/Pools'
import Accounts from './components/Accounts'
import Analytics from './components/Analytics'
import Logs from './components/Logs'
import Settings from './components/Settings'
import Admins from './components/Admins'
import Webhooks from './components/Webhooks'
import AuditLog from './components/AuditLog'
import Invites from './components/Invites'
import Downloads from './components/Downloads'
import ModelAliases from './components/ModelAliases'
import Sessions from './components/Sessions'
import InviteUse from './components/InviteUse'
import PoolDetail from './components/PoolDetail'
import SetupLink from './components/SetupLink'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/invite" element={<InviteUse />} />
        <Route path="/invite/:token" element={<InviteUse />} />
        <Route path="/setup/:token" element={<SetupLink />} />
        <Route path="/*" element={<PrivateRoutes />} />
      </Routes>
    </BrowserRouter>
  )
}

function PrivateRoutes() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />
  }

  return (
    <Layout admin={data}>
      <Routes>
        <Route path="/"          element={<Dashboard />} />
        <Route path="/users"     element={<Users />} />
        <Route path="/pools"     element={<Pools />} />
        <Route path="/pools/:id" element={<PoolDetail />} />
        <Route path="/accounts"  element={<Accounts />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/logs"      element={<Logs />} />
        <Route path="/settings"  element={<Settings />} />
        <Route path="/admins"    element={<Admins />} />
        <Route path="/webhooks"  element={<Webhooks />} />
        <Route path="/audit"     element={<AuditLog />} />
        <Route path="/invites"   element={<Invites />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/aliases"  element={<ModelAliases />} />
        <Route path="/sessions" element={<Sessions />} />
      </Routes>
    </Layout>
  )
}

export default App
