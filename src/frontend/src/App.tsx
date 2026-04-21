import React, { Component, ReactNode } from 'react'
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
import AccountDetail from './components/AccountDetail'
import UserDetail from './components/UserDetail'
import SetupLink from './components/SetupLink'
import Teams from './components/Teams'
import TeamDetail from './components/TeamDetail'
import MCPServers from './components/MCPServers'
import Quotas from './components/Quotas'
import OAuthCallback from './components/OAuthCallback'
import { ToastProvider } from './components/ToastProvider'

class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Something went wrong</h1>
            <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm">{this.state.error.message}</p>
            <button onClick={() => { this.setState({ error: null }); window.location.reload() }}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">
              Reload page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/invite" element={<InviteUse />} />
          <Route path="/invite/:token" element={<InviteUse />} />
          <Route path="/setup/:token" element={<SetupLink />} />
          <Route path="/oauth/code/callback" element={<OAuthCallback />} />
          <Route path="/*" element={<PrivateRoutes />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
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
    <ErrorBoundary>
      <Layout admin={data}>
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/users"     element={<Users />} />
          <Route path="/pools"     element={<Pools />} />
          <Route path="/pools/:id" element={<PoolDetail />} />
          <Route path="/accounts"  element={<Accounts />} />
          <Route path="/accounts/:id" element={<AccountDetail />} />
          <Route path="/users/:id" element={<UserDetail />} />
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
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:id" element={<TeamDetail />} />
          <Route path="/mcp-servers" element={<MCPServers />} />
          <Route path="/quotas" element={<Quotas />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  )
}

export default App
