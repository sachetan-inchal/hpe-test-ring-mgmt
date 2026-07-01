import { useState, useContext, useEffect, useRef, useCallback } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation, Outlet } from 'react-router-dom'
import { AuthContext } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import LandingPage from './pages/LandingPage'
import DiscoveryPage from './pages/DiscoveryPage'
import TopologyPage from './pages/TopologyPage'
import EmulatorPage from './pages/EmulatorPage'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import HealthPage from './pages/HealthPage'
import InventoryPage from './pages/InventoryPage'
import SSHRingPage from './pages/SSHRingPage'
import TestcasesMarkdownViewerPage from './pages/TestcasesMarkdownViewerPage'
import { Search, Radar, Map, Terminal, MessageSquare, Settings, Activity, LogOut, Menu, X, ChevronRight, Database, Layers, Save, RefreshCw, ChevronDown, Check, Cpu, PanelTop, FileCode } from 'lucide-react'

const FLASK_API = `http://${window.location.hostname}:5005`
const CHATBOT_API = '/chatbot'

const NAV_ITEMS = [
  { path: '/topology', label: 'Dashboard', icon: Map, desc: 'SAN diagram & ring topology' },
  { path: '/ssh-ring', label: 'Inventory', icon: Layers, desc: 'Configure and discover SSH rings' },
  { path: '/chat', label: 'AI Assistant', icon: MessageSquare, desc: 'Intelligent chat' },
  { path: '/emulator', label: 'SSH Console', icon: Terminal, desc: 'CLI terminal' },
  { path: '/admin', label: 'Admin', icon: Settings, desc: 'Device & schema mgmt' },
  { path: '/health', label: 'Health', icon: Activity, desc: 'System overview' },
  { path: '/discovery', label: '(Virtual demo) Discovery', icon: Radar, desc: 'Live BFS network scan' },
  { path: '/inventory', label: 'Inventory', icon: Database, desc: 'Hierarchical resource view' },
  { path: '/parser-editor', label: 'PARSER EDITOR', icon: FileCode, desc: 'View parser output for testcases-markdown.md' },
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

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <AppShell />
    </ProtectedRoute>
  )
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  
  // Track which tabs are visible (persisted in localStorage)
  const [visibleTabs, setVisibleTabs] = useState(() => {
    try {
      const saved = localStorage.getItem('visible_tabs')
      return saved ? JSON.parse(saved) : {
        '/ssh-ring': true,
        '/topology': true,
        '/inventory': true,
        '/chat': true,
        '/admin': false,
        '/health': false,
        '/discovery': false,
        '/emulator': false,
        '/parser-editor': true,
      }
    } catch {
      return {
        '/ssh-ring': true,
        '/topology': true,
        '/inventory': true,
        '/chat': true,
        '/admin': false,
        '/health': false,
        '/discovery': false,
        '/emulator': false,
        '/parser-editor': true,
      }
    }
  })

  const [deviceFilter, setDeviceFilter] = useState('virtual')
  const [deviceKindMap, setDeviceKindMap] = useState({})
  
  // User Profile Settings States
  const [userSettingsOpen, setUserSettingsOpen] = useState(false)
  const [userSettingsTeam, setUserSettingsTeam] = useState('')
  const [userSettingsManagedTeams, setUserSettingsManagedTeams] = useState([])
  const [allTeams, setAllTeams] = useState([])

  useEffect(() => {
    if (userSettingsOpen) {
      setUserSettingsTeam(user?.team || '')
      setUserSettingsManagedTeams(Array.isArray(user?.managedTeams) ? user.managedTeams : [])
      fetch(`${FLASK_API}/api/teams`)
        .then(r => r.json())
        .then(data => {
          if (data.teams && Array.isArray(data.teams)) {
            const normalized = data.teams.map(t => {
              if (typeof t === 'string') {
                return { id: t.toLowerCase().replace(/ /g, '-'), name: t, manager_name: 'Test' }
              }
              return {
                id: t.id || t.name?.toLowerCase().replace(/ /g, '-'),
                name: t.name || t,
                manager_name: t.manager_name || 'Test'
              }
            })
            setAllTeams(normalized)
          }
        })
        .catch(() => {})
    }
  }, [userSettingsOpen, user])

  useEffect(() => {
    async function fetchDevices() {
      try {
        const res = await fetch(`${FLASK_API}/api/credentials/list`)
        if (res.ok) {
          const data = await res.json()
          const devices = data.devices || []
          const map = {}
          devices.forEach(d => {
            const kind = d.device_kind || 'real'
            if (d.device_name) map[d.device_name] = kind
            if (d.ip_address) map[d.ip_address] = kind
            if (d.ip) map[d.ip] = kind
          })
          setDeviceKindMap(map)
        }
      } catch (err) {
        console.error("Failed to fetch devices for kind mapping", err)
      }
    }
    fetchDevices()
  }, [])

  const toggleTabVisibility = (path) => {
    setVisibleTabs(prev => {
      const next = { ...prev, [path]: prev[path] === false ? true : false }
      localStorage.setItem('visible_tabs', JSON.stringify(next))
      return next
    })
  }

  const isAdmin = (user?.role || '').toLowerCase() === 'admin'
  const allowedNavItems = NAV_ITEMS.filter(item => item.path !== '/admin' || isAdmin)
  const visibleNavItems = allowedNavItems.filter(item => visibleTabs[item.path] !== false)

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <div className="app-shell">
            {/* Sidebar */}
            <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
              <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem' }}>
                <img 
                  src="/images/sidebarlogo.png" 
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

              {/* Universal Device Filter Toggle */}
              <div style={{ padding: sidebarCollapsed ? '8px' : '12px 16px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', margin: '8px 0', display: 'flex', flexDirection: 'column', alignItems: sidebarCollapsed ? 'center' : 'stretch' }}>
                {!sidebarCollapsed && (
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 8 }}>
                    Device Filter
                  </div>
                )}
                {sidebarCollapsed ? (
                  <button
                    onClick={() => setDeviceFilter(f => f === 'real' ? 'virtual' : 'real')}
                    title={`Switch to ${deviceFilter === 'real' ? 'Virtual' : 'Real'} devices`}
                    style={{
                      width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255,255,255,0.05)', color: 'var(--hpe-green)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {deviceFilter === 'real' ? <Layers size={16} /> : <Cpu size={16} />}
                  </button>
                ) : (
                  <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
                    <button
                      onClick={() => setDeviceFilter('real')}
                      style={{
                        flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: deviceFilter === 'real' ? 'var(--hpe-green)' : 'transparent',
                        color: deviceFilter === 'real' ? 'white' : 'var(--muted)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Real
                    </button>
                    <button
                      onClick={() => setDeviceFilter('virtual')}
                      style={{
                        flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: deviceFilter === 'virtual' ? 'var(--hpe-green)' : 'transparent',
                        color: deviceFilter === 'virtual' ? 'white' : 'var(--muted)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Virtual
                    </button>
                  </div>
                )}
              </div>

              <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div className="user-badge" title={user?.username || 'User'} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', padding: 0 }}>
                    <div className="user-avatar-small" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--hpe-green)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 12 }}>
                      {(user?.name || user?.username || 'U')[0].toUpperCase()}
                    </div>
                    {!sidebarCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                        <span className="user-name" style={{ fontWeight: 600, fontSize: 12, color: 'var(--foreground)' }}>{user?.name || user?.username}</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{user?.team || 'No Team'}</span>
                      </div>
                    )}
                  </div>
                  {!sidebarCollapsed && (
                    <button
                      onClick={() => setUserSettingsOpen(true)}
                      title="Profile Settings"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 4,
                        borderRadius: 4
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--foreground)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
                    >
                      <Settings size={16} />
                    </button>
                  )}
                </div>
                
                <button className="nav-item logout-btn" onClick={logout} title="Logout" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', borderRadius: 6 }}>
                  <LogOut size={16} />
                  {!sidebarCollapsed && <span style={{ fontSize: 12 }}>Logout</span>}
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
                  <span className="topbar-label">SAN Tool</span>
                </div>
                <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {visibleNavItems.find(n => location.pathname.startsWith(n.path)) && (
                    <span className="topbar-page-label">
                      {visibleNavItems.find(n => location.pathname.startsWith(n.path))?.label}
                    </span>
                  )}
                  {/* ── Global Snapshot Selector ── */}
                  {/* <SnapshotSelector apiBase={FLASK_API} /> */}

                  {/* Settings Gear Button */}
                  <button 
                    onClick={() => setSettingsOpen(true)} 
                    title="Interface Settings" 
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--muted)', 
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 6, borderRadius: 8, transition: 'color 0.2s, background 0.2s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <Settings size={18} />
                  </button>
                </div>
              </header>

              {/* Page content */}
              <div className="app-content">
                <Routes>
                  <Route path="/" element={<Navigate to="/topology" replace />} />
                  <Route path="/discovery" element={<DiscoveryPage apiBase={FLASK_API} />} />
                  <Route path="/topology" element={<TopologyPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} deviceFilter={deviceFilter} deviceKindMap={deviceKindMap} />} />
                  <Route path="/inventory" element={<InventoryPage apiBase={FLASK_API} deviceFilter={deviceFilter} deviceKindMap={deviceKindMap} />} />
                  <Route path="/ssh-ring" element={<SSHRingPage apiBase={FLASK_API} />} />
                  <Route path="/emulator" element={<EmulatorPage apiBase={FLASK_API} deviceFilter={deviceFilter} />} />
                  <Route path="/chat" element={<ChatPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} />} />
                  <Route path="/admin" element={isAdmin ? <AdminPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} /> : <Navigate to="/ssh-ring" replace />} />
                  <Route path="/health" element={<HealthPage apiBase={FLASK_API} chatbotApi={CHATBOT_API} />} />
                  <Route path="/parser-editor" element={<TestcasesMarkdownViewerPage apiBase={FLASK_API} />} />
                  <Route path="*" element={<Navigate to="/ssh-ring" replace />} />
                </Routes>
              </div>
            </main>
          </div>

          {/* Settings Modal */}
          {settingsOpen && (
            <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
              <div className="glass-card rise-in" onClick={e => e.stopPropagation()} style={{ padding: 24, width: 400, maxWidth: '90vw' }}>
                <h3 style={{ fontSize: 16, marginBottom: 12, color: 'var(--foreground)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
                  Interface Settings
                </h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Show or hide tabs in the sidebar navigation:</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  {allowedNavItems.map(item => {
                    const isVisible = visibleTabs[item.path] !== false
                    return (
                      <div key={item.path} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                           <item.icon size={16} style={{ color: 'var(--muted)' }} />
                           <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{item.label}</span>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18 }}>
                          <input 
                            type="checkbox" 
                            checked={isVisible} 
                            onChange={() => toggleTabVisibility(item.path)} 
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: isVisible ? 'var(--hpe-green, #01a982)' : 'rgba(255, 255, 255, 0.15)',
                            border: '1px solid var(--line, rgba(255, 255, 255, 0.15))',
                            transition: 'background-color 0.2s, border-color 0.2s', borderRadius: 20
                          }}>
                            <span style={{
                              position: 'absolute', height: 12, width: 12, left: 2, bottom: 2,
                              backgroundColor: 'white', transition: 'transform 0.2s', borderRadius: '50%',
                              transform: isVisible ? 'translateX(16px)' : 'none'
                            }} />
                          </span>
                        </label>
                      </div>
                    )
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>Done</button>
                </div>
              </div>
            </div>
          )}

          {/* User Profile Settings Modal */}
          {userSettingsOpen && (
            <div className="modal-backdrop" onClick={() => setUserSettingsOpen(false)}>
              <div className="glass-card rise-in" onClick={e => e.stopPropagation()} style={{ padding: 24, width: 400, maxWidth: '90vw' }}>
                <h3 style={{ fontSize: 16, marginBottom: 12, color: 'var(--foreground)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
                  User Profile Settings
                </h3>
                <form onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    const res = await fetch(`${CHATBOT_API}/auth/update`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        userId: user._id,
                        team: userSettingsTeam,
                        managedTeams: userSettingsManagedTeams
                      })
                    })
                    if (res.ok) {
                      const updatedUser = await res.json()
                      login({ ...user, ...updatedUser })
                      setUserSettingsOpen(false)
                    } else {
                      alert('Failed to update settings')
                    }
                  } catch (err) {
                    console.error(err)
                  }
                }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  <div className="form-group">
                    <label>Assigned Team</label>
                    <select
                      className="input"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', background: '#161b22', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', outline: 'none' }}
                      value={userSettingsTeam}
                      onChange={e => setUserSettingsTeam(e.target.value)}
                    >
                      <option value="" style={{ background: '#161b22', color: '#ffffff' }}>None</option>
                      {allTeams.map(t => (
                        <option key={t.id || t.name} value={t.name} style={{ background: '#161b22', color: '#ffffff' }}>
                          {t.name}{t.manager_name ? ` (${t.manager_name})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(user?.role === 'manager' || user?.role === 'director') && (
                    <div className="form-group">
                      <label style={{ marginBottom: 8, display: 'block' }}>Managed Teams</label>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        maxHeight: 150,
                        overflowY: 'auto',
                        background: 'rgba(255,255,255,0.03)',
                        padding: '10px 16px',
                        borderRadius: 6,
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}>
                        {allTeams.map(t => {
                          const isChecked = userSettingsManagedTeams.includes(t.name)
                          return (
                            <label key={t.id || t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setUserSettingsManagedTeams(prev => [...prev, t.name])
                                  } else {
                                    setUserSettingsManagedTeams(prev => prev.filter(item => item !== t.name))
                                  }
                                }}
                              />
                              {t.name}{t.manager_name ? ` (${t.manager_name})` : ''}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button type="submit" className="btn btn-primary">Save Settings</button>
                    <button type="button" className="btn" onClick={() => setUserSettingsOpen(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </ProtectedRoute>
      } />
    </Routes>
  )
}
