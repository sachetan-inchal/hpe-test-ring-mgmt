import { useState, useContext } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { AuthContext } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import DiscoveryPage from './pages/DiscoveryPage'
import TopologyPage from './pages/TopologyPage'
import EmulatorPage from './pages/EmulatorPage'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import HealthPage from './pages/HealthPage'
import InventoryPage from './pages/InventoryPage'
import { Search, Radar, Map, Terminal, MessageSquare, Settings, Activity, LogOut, Menu, X, ChevronRight, Database } from 'lucide-react'

const FLASK_API = ''
const CHATBOT_API = '/chatbot'

const NAV_ITEMS = [
  { path: '/discovery', label: 'Discovery', icon: Radar, desc: 'Live BFS network scan' },
  { path: '/topology', label: 'Topology', icon: Map, desc: 'SAN diagram & graph' },
  { path: '/inventory', label: 'Inventory', icon: Database, desc: 'Hierarchical resource view' },
  { path: '/emulator', label: 'Emulator', icon: Terminal, desc: 'CLI terminal' },
  { path: '/chat', label: 'AI Assistant', icon: MessageSquare, desc: 'Intelligent chat' },
  { path: '/admin', label: 'Admin', icon: Settings, desc: 'Device & schema mgmt' },
  { path: '/health', label: 'Health', icon: Activity, desc: 'System overview' },
]

function ProtectedRoute({ children }) {
  const { user, loading } = useContext(AuthContext)
  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <span>Authenticating...</span>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { user, logout } = useContext(AuthContext)
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Login page — no shell
  if (location.pathname === '/login') {
    return <Routes><Route path="/login" element={<LoginPage />} /></Routes>
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <div className="app-shell">
            {/* Sidebar */}
            <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
              <div className="sidebar-brand">
                <div className="brand-logo">
                  <span className="brand-rect" />
                  <div className="brand-text">
                    <strong>Hewlett Packard</strong>
                    <small>Enterprise</small>
                  </div>
                </div>
                <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(c => !c)}>
                  <ChevronRight size={16} style={{ transform: sidebarCollapsed ? 'rotate(0)' : 'rotate(180deg)', transition: 'transform 0.3s' }} />
                </button>
              </div>

              <nav className="sidebar-nav">
                {NAV_ITEMS.map(item => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                    title={item.label}
                  >
                    <item.icon size={20} />
                    {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
                  </NavLink>
                ))}
              </nav>

              <div className="sidebar-footer">
                <div className="user-badge" title={user?.username || user?.email || 'User'}>
                  <div className="user-avatar-small">{(user?.username || user?.email || 'U')[0].toUpperCase()}</div>
                  {!sidebarCollapsed && (
                    <span className="user-name">{user?.username || user?.email || 'User'}</span>
                  )}
                </div>
                <button className="nav-item logout-btn" onClick={logout} title="Logout">
                  <LogOut size={18} />
                  {!sidebarCollapsed && <span className="nav-label">Logout</span>}
                </button>
              </div>
            </aside>

            {/* Mobile overlay */}
            {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />}

            {/* Main content */}
            <main className="app-main">
              {/* Top bar */}
              <header className="app-topbar">
                <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(m => !m)}>
                  {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
                </button>
                <div className="topbar-title">
                  <span className="topbar-hpe">HPE</span>
                  <span className="topbar-label">SAN Unified Platform</span>
                </div>
                <div className="topbar-right">
                  {NAV_ITEMS.find(n => location.pathname.startsWith(n.path)) && (
                    <span className="topbar-page-label">
                      {NAV_ITEMS.find(n => location.pathname.startsWith(n.path))?.label}
                    </span>
                  )}
                </div>
              </header>

              {/* Page content */}
              <div className="app-content">
                <Routes>
                  <Route path="/" element={<Navigate to="/discovery" replace />} />
                  <Route path="/discovery" element={<DiscoveryPage apiBase={FLASK_API} />} />
                  <Route path="/topology" element={<TopologyPage apiBase={FLASK_API} />} />
                  <Route path="/inventory" element={<InventoryPage apiBase={FLASK_API} />} />
                  <Route path="/emulator" element={<EmulatorPage apiBase={FLASK_API} />} />
                  <Route path="/chat" element={<ChatPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} />} />
                  <Route path="/admin" element={<AdminPage apiBase={FLASK_API} />} />
                  <Route path="/health" element={<HealthPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} />} />
                  <Route path="*" element={<Navigate to="/discovery" replace />} />
                </Routes>
              </div>
            </main>
          </div>
        </ProtectedRoute>
      } />
    </Routes>
  )
}
