import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { authApi, Admin } from '../lib/api'
import {
  LayoutDashboard, Users, Layers, Server, BarChart2, Settings, LogOut,
  ScrollText, ShieldCheck, Webhook, ClipboardList, Mail, Download, ArrowLeftRight, MonitorSmartphone,
  Moon, Sun
} from 'lucide-react'

const navItems = [
  { path: '/',          label: 'Dashboard',  icon: LayoutDashboard },
  { path: '/users',     label: 'Users',      icon: Users },
  { path: '/pools',     label: 'Pools',      icon: Layers },
  { path: '/accounts',  label: 'Accounts',   icon: Server },
  { path: '/analytics', label: 'Analytics',  icon: BarChart2 },
  { path: '/logs',      label: 'Logs',       icon: ScrollText },
  { path: '/settings',  label: 'Settings',   icon: Settings },
]

const adminNavItems = [
  { path: '/admins',    label: 'Admin Users', icon: ShieldCheck },
  { path: '/webhooks',  label: 'Webhooks',    icon: Webhook },
  { path: '/invites',   label: 'Invites',     icon: Mail },
  { path: '/downloads', label: 'Downloads',   icon: Download },
  { path: '/audit',     label: 'Audit Log',   icon: ClipboardList },
  { path: '/aliases',  label: 'Model Aliases', icon: ArrowLeftRight },
  { path: '/sessions', label: 'Sessions',       icon: MonitorSmartphone },
]

interface LayoutProps {
  admin: Admin
  children: React.ReactNode
}

export default function Layout({ admin, children }: LayoutProps) {
  const location = useLocation()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'))

  function toggleDark() {
    const next = !dark
    setDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  async function handleLogout() {
    await authApi.logout()
    qc.clear()
    navigate('/login')
  }

  function NavLink({ path, label, icon: Icon }: { path: string; label: string; icon: React.ElementType }) {
    const active = location.pathname === path
    return (
      <Link
        to={path}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          active ? 'bg-gray-700 text-white font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
      </Link>
    )
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 dark:bg-gray-950 text-white flex flex-col">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" viewBox="0 0 32 32" fill="none">
                {/* Hub */}
                <circle cx="16" cy="16" r="4.5" fill="currentColor"/>
                {/* Top node */}
                <circle cx="16" cy="4" r="3" fill="currentColor" fillOpacity="0.65"/>
                <line x1="16" y1="7" x2="16" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45"/>
                {/* Bottom-left node */}
                <circle cx="5" cy="26" r="3" fill="currentColor" fillOpacity="0.65"/>
                <line x1="7.5" y1="24.2" x2="13" y2="20.2" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45"/>
                {/* Bottom-right node */}
                <circle cx="27" cy="26" r="3" fill="currentColor" fillOpacity="0.65"/>
                <line x1="24.5" y1="24.2" x2="19" y2="20.2" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45"/>
              </svg>
            </div>
            <span className="font-semibold text-sm">OurClaude</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-0.5">
            {navItems.map(item => <NavLink key={item.path} {...item} />)}
          </div>

          {admin.role === 'super_admin' && (
            <>
              <div className="mt-4 mb-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Admin
              </div>
              <div className="space-y-0.5">
                {adminNavItems.map(item => <NavLink key={item.path} {...item} />)}
              </div>
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-700">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
              <span className="text-xs font-bold text-white">
                {admin.username[0]?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">{admin.username}</p>
              <p className="text-xs text-gray-400">
                {admin.totp_enabled ? '🔐 2FA on' : 'No 2FA'} · {admin.role === 'super_admin' ? 'superadmin' : 'viewer'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <Moon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <button
              onClick={toggleDark}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className={`relative inline-flex w-9 h-5 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${dark ? 'bg-brand-500' : 'bg-gray-300'}`}
            >
              <span
                className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform duration-200 ${dark ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </button>
            <Sun className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-2 py-1 ml-auto text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
