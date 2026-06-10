import { useState, useContext, useEffect, useRef, useCallback } from 'react'
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
import SSHRingPage from './pages/SSHRingPage'
import { Search, Radar, Map, Terminal, MessageSquare, Settings, Activity, LogOut, Menu, X, ChevronRight, Database, Layers, Save, RefreshCw, ChevronDown, Check } from 'lucide-react'

const FLASK_API = `http://${window.location.hostname}:5005`
const CHATBOT_API = '/chatbot'

const NAV_ITEMS = [
  { path: '/discovery', label: 'Discovery', icon: Radar, desc: 'Live BFS network scan' },
  { path: '/topology', label: 'Test Ring Viewer', icon: Map, desc: 'SAN diagram & ring topology' },
  { path: '/inventory', label: 'Inventory', icon: Database, desc: 'Hierarchical resource view' },
  { path: '/ssh-ring', label: 'SSH Ring Manager', icon: Layers, desc: 'Configure and discover SSH rings' },
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

// ── Snapshot Selector Component ────────────────────────────────────────────────
function SnapshotSelector({ apiBase }) {
  const [snapshots, setSnapshots] = useState([])
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('active_snapshot_id') || '__live__')
  const [selectedLabel, setSelectedLabel] = useState(() => localStorage.getItem('active_snapshot_label') || '🌐 Live Crawler Network')
  const [open, setOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [restoreOverlay, setRestoreOverlay] = useState(false)
  const dropdownRef = useRef(null)

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/ingest/log/backups`)
      if (res.ok) {
        const data = await res.json()
        setSnapshots(data.backups || [])
      }
    } catch (e) {
      console.error('Failed to fetch snapshots', e)
    }
  }, [apiBase])

  useEffect(() => {
    fetchSnapshots()
  }, [fetchSnapshots])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
        setShowSaveInput(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelectLive = () => {
    if (selectedId === '__live__') { setOpen(false); return }
    if (!window.confirm('Switch to Live Crawler Network? This will restore the live database state.')) return
    localStorage.setItem('active_snapshot_id', '__live__')
    localStorage.setItem('active_snapshot_label', '🌐 Live Crawler Network')
    setSelectedId('__live__')
    setSelectedLabel('🌐 Live Crawler Network')
    setOpen(false)
    // No restore needed for live — just signal via reload
    window.location.reload()
  }

  const handleSelectSnapshot = async (snap) => {
    if (snap.backup_id === selectedId) { setOpen(false); return }
    if (!window.confirm(`Switch to snapshot:\n"${snap.label}"?\n\nThis will restore the database to this saved state.`)) return
    setOpen(false)
    setRestoring(true)
    setRestoreOverlay(true)
    try {
      const res = await fetch(`${apiBase}/api/ingest/log/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_id: snap.backup_id })
      })
      if (res.ok) {
        localStorage.setItem('active_snapshot_id', snap.backup_id)
        localStorage.setItem('active_snapshot_label', snap.label)
        setSelectedId(snap.backup_id)
        setSelectedLabel(snap.label)
        // brief pause to show overlay then reload
        setTimeout(() => window.location.reload(), 1200)
      } else {
        const err = await res.json()
        alert(`Restore failed: ${err.error || 'Unknown error'}`)
        setRestoring(false)
        setRestoreOverlay(false)
      }
    } catch (e) {
      alert(`Restore error: ${e.message}`)
      setRestoring(false)
      setRestoreOverlay(false)
    }
  }

  const handleSave = async () => {
    if (!saveLabel.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`${apiBase}/api/ingest/log/backup/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: saveLabel.trim() })
      })
      if (res.ok) {
        setSaveLabel('')
        setShowSaveInput(false)
        await fetchSnapshots()
      } else {
        const err = await res.json()
        alert(`Save failed: ${err.error || 'Unknown error'}`)
      }
    } catch (e) {
      alert(`Save error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (iso) => {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  return (
    <>
      {/* Restore Overlay */}
      {restoreOverlay && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(12px)',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(1,169,130,0.15) 0%, rgba(22,27,34,0.95) 100%)',
            border: '1px solid rgba(1,169,130,0.3)',
            borderRadius: 20, padding: '40px 60px', textAlign: 'center',
            boxShadow: '0 0 80px rgba(1,169,130,0.2)',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              border: '3px solid rgba(1,169,130,0.4)',
              borderTopColor: 'var(--hpe-green)',
              animation: 'spin 0.9s linear infinite',
              margin: '0 auto 20px'
            }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', marginBottom: 8 }}>
              Restoring Snapshot...
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Hot-swapping database context
            </div>
          </div>
        </div>
      )}

      <div ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Main selector button */}
        <button
          id="snapshot-selector-btn"
          onClick={() => { setOpen(o => !o); setShowSaveInput(false) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px',
            background: open ? 'rgba(1,169,130,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${open ? 'rgba(1,169,130,0.4)' : 'rgba(72,79,88,0.5)'}`,
            borderRadius: 8, cursor: 'pointer',
            color: selectedId === '__live__' ? 'var(--hpe-green)' : 'var(--foreground)',
            fontSize: 12, fontWeight: 500,
            transition: 'all 0.2s ease',
            maxWidth: 260, minWidth: 180,
          }}
          title="Switch active data source"
        >
          <Layers size={13} style={{ flexShrink: 0, color: selectedId === '__live__' ? 'var(--hpe-green)' : 'var(--accent-purple)' }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
            {selectedLabel}
          </span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
        </button>

        {/* Save button */}
        <button
          onClick={() => { setShowSaveInput(s => !s); setOpen(false) }}
          title="Save current state as snapshot"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 10px',
            background: showSaveInput ? 'rgba(1,169,130,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${showSaveInput ? 'rgba(1,169,130,0.4)' : 'rgba(72,79,88,0.5)'}`,
            borderRadius: 8, cursor: 'pointer',
            color: showSaveInput ? 'var(--hpe-green)' : 'var(--muted)',
            fontSize: 11, fontWeight: 500,
            transition: 'all 0.2s ease',
          }}
        >
          <Save size={12} />
          <span style={{ display: window.innerWidth > 900 ? 'inline' : 'none' }}>Save</span>
        </button>

        {/* Dropdown panel */}
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 320, maxHeight: 420,
            background: 'rgba(22,27,34,0.97)',
            border: '1px solid rgba(72,79,88,0.6)',
            borderRadius: 12, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(1,169,130,0.1)',
            backdropFilter: 'blur(20px)',
            zIndex: 1000,
            animation: 'slideDown 0.15s ease',
          }}>
            {/* Header */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid rgba(72,79,88,0.4)',
              background: 'rgba(1,169,130,0.06)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hpe-green)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Active Data Source
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} available
              </div>
            </div>

            {/* Options */}
            <div style={{ overflowY: 'auto', maxHeight: 320 }}>
              {/* Live option */}
              <div
                onClick={handleSelectLive}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', cursor: 'pointer',
                  background: selectedId === '__live__' ? 'rgba(1,169,130,0.1)' : 'transparent',
                  borderBottom: '1px solid rgba(72,79,88,0.2)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (selectedId !== '__live__') e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { e.currentTarget.style.background = selectedId === '__live__' ? 'rgba(1,169,130,0.1)' : 'transparent' }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hpe-green)', flexShrink: 0, boxShadow: '0 0 6px var(--hpe-green)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: selectedId === '__live__' ? 'var(--hpe-green)' : 'var(--foreground)' }}>
                    🌐 Live Crawler Network
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Current active dataset</div>
                </div>
                {selectedId === '__live__' && <Check size={14} style={{ color: 'var(--hpe-green)', flexShrink: 0 }} />}
              </div>

              {/* Snapshot list */}
              {snapshots.length === 0 && (
                <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                  No snapshots yet. Save a state to create one.
                </div>
              )}
              {snapshots.map((snap) => (
                <div
                  key={snap.backup_id}
                  onClick={() => handleSelectSnapshot(snap)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', cursor: restoring ? 'not-allowed' : 'pointer',
                    background: selectedId === snap.backup_id ? 'rgba(88,166,255,0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(72,79,88,0.15)',
                    transition: 'background 0.15s',
                    opacity: restoring ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (selectedId !== snap.backup_id && !restoring) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = selectedId === snap.backup_id ? 'rgba(88,166,255,0.08)' : 'transparent' }}
                >
                  <Database size={13} style={{ color: selectedId === snap.backup_id ? 'var(--accent-blue)' : 'var(--accent-purple)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 500,
                      color: selectedId === snap.backup_id ? 'var(--accent-blue)' : 'var(--foreground)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {snap.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 8 }}>
                      <span>{formatDate(snap.created_at)}</span>
                      <span>·</span>
                      <span>{snap.neo4j_nodes} nodes</span>
                    </div>
                  </div>
                  {selectedId === snap.backup_id && <Check size={14} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />}
                </div>
              ))}
            </div>

            {/* Refresh button */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(72,79,88,0.3)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={fetchSnapshots}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 11, color: 'var(--muted)', background: 'transparent',
                  border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6,
                  transition: 'color 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--foreground)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
              >
                <RefreshCw size={11} /> Refresh list
              </button>
            </div>
          </div>
        )}

        {/* Save input panel */}
        {showSaveInput && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 300,
            background: 'rgba(22,27,34,0.97)',
            border: '1px solid rgba(72,79,88,0.6)',
            borderRadius: 12, padding: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(20px)',
            zIndex: 1000,
            animation: 'slideDown 0.15s ease',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hpe-green)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              💾 Save Current State
            </div>
            <input
              autoFocus
              value={saveLabel}
              onChange={e => setSaveLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder="e.g. Production Crawler Baseline"
              style={{
                width: '100%', padding: '8px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(72,79,88,0.6)',
                borderRadius: 8, color: 'var(--foreground)',
                fontSize: 12, fontFamily: 'var(--font-sans)',
                outline: 'none', marginBottom: 10,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSave}
                disabled={saving || !saveLabel.trim()}
                style={{
                  flex: 1, padding: '7px 0',
                  background: saving || !saveLabel.trim() ? 'rgba(1,169,130,0.3)' : 'var(--hpe-green)',
                  border: 'none', borderRadius: 7, color: 'white',
                  fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {saving ? 'Saving…' : 'Save Snapshot'}
              </button>
              <button
                onClick={() => setShowSaveInput(false)}
                style={{
                  padding: '7px 14px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(72,79,88,0.4)',
                  borderRadius: 7, color: 'var(--muted)', fontSize: 12, cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { user, logout } = useContext(AuthContext)
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isAdmin = (user?.role || '').toLowerCase() === 'admin'
  const visibleNavItems = NAV_ITEMS.filter(item => item.path !== '/admin' || isAdmin)

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
              <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem' }}>
                <img 
                  src="/images/image.png" 
                  alt="HPE Logo" 
                  style={{ width: sidebarCollapsed ? '0' : '140px', opacity: sidebarCollapsed ? 0 : 1, transition: 'all 0.3s ease', objectFit: 'contain' }} 
                />
                <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(c => !c)}>
                  <ChevronRight size={16} style={{ transform: sidebarCollapsed ? 'rotate(0)' : 'rotate(180deg)', transition: 'transform 0.3s' }} />
                </button>
              </div>

              <nav className="sidebar-nav">
                {visibleNavItems.map(item => (
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
                <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {visibleNavItems.find(n => location.pathname.startsWith(n.path)) && (
                    <span className="topbar-page-label">
                      {visibleNavItems.find(n => location.pathname.startsWith(n.path))?.label}
                    </span>
                  )}
                  {/* ── Global Snapshot Selector ── */}
                  <SnapshotSelector apiBase={FLASK_API} />
                </div>
              </header>

              {/* Page content */}
              <div className="app-content">
                <Routes>
                  <Route path="/" element={<Navigate to="/discovery" replace />} />
                  <Route path="/discovery" element={<DiscoveryPage apiBase={FLASK_API} />} />
                  <Route path="/topology" element={<TopologyPage apiBase={FLASK_API} />} />
                  <Route path="/inventory" element={<InventoryPage apiBase={FLASK_API} />} />
                  <Route path="/ssh-ring" element={<SSHRingPage apiBase={FLASK_API} />} />
                  <Route path="/emulator" element={<EmulatorPage apiBase={FLASK_API} />} />
                  <Route path="/chat" element={<ChatPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} />} />
                  <Route path="/admin" element={isAdmin ? <AdminPage apiBase={FLASK_API} /> : <Navigate to="/discovery" replace />} />
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
