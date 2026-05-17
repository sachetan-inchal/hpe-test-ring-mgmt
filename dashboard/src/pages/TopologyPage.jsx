import { useState, useEffect, useMemo, useContext } from 'react'
import { Download } from 'lucide-react'
import TopologyCanvas from '../components/TopologyCanvas'
import SANDiagram from '../components/SANDiagram'
import NodeCard from '../components/NodeCard'
import { AuthContext } from '../context/AuthContext'
import teamConfig from '../teamconfig.json'

// Build a lookup: deviceId -> clusterId, clusterId -> teamId
const deviceToCluster = {}
const clusterToTeam = {}
teamConfig.clusters.forEach(c => {
  c.devices.forEach(d => { deviceToCluster[d] = c.id })
})
teamConfig.teams.forEach(t => {
  clusterToTeam[t.clusterId] = t.id
})

// Given a node id, what team does it belong to?
function getNodeTeam(nodeId) {
  const clusterId = deviceToCluster[nodeId]
  return clusterId ? clusterToTeam[clusterId] : null
}

// Given a node id, what cluster does it belong to?
function getNodeCluster(nodeId) {
  return deviceToCluster[nodeId] || null
}

export default function TopologyPage({ apiBase }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [focusedId, setFocusedId] = useState(null)
  const [expandedIds, setExpandedIds] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('diagram')
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const fetchWithData = async (url, timeoutMs = 4500) => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          try {
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) return null
            const data = await res.json()
            if (!data.nodes || data.nodes.length === 0) return null
            return data
          } catch { return null }
          finally { clearTimeout(timer) }
        }

        const localSources = [
          `${apiBase}/api/ontology/topology`,
          `${apiBase}/api/graph/neo4j`,
          `${apiBase}/api/sim/mock-topology`,
        ]
        const localResults = await Promise.all(localSources.map(url => fetchWithData(url)))
        let json = localResults.find(Boolean)
        if (!json) json = await fetchWithData(`https://hpe-ontology-and-graph.onrender.com/topology`)
        if (!json) throw new Error('Failed to load topology from any source or databases are empty')

        if (json.nodes?.[0]?.data) {
          setData({
            nodes: json.nodes.map(n => ({
              id: n.data.id, name: n.data.name || n.data.id,
              type: n.data.label || 'Unknown', status: n.data.status || 'normal',
              category: n.data.category || 'main', parentId: n.data.parentId || null,
              isDecommissioned: false, ...n.data
            })),
            edges: json.edges.map(e => ({ from: e.data.source, to: e.data.target, label: e.data.label || '' }))
          })
        } else {
          setData(json)
        }
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }
    load()
  }, [apiBase])

  const { user } = useContext(AuthContext)

  // Roles: 'admin', 'manager', 'user'
  const initialRole = user?.role === 'admin' ? 'admin' : (user?.role === 'manager' || user?.role === 'senior_manager') ? 'manager' : 'user'
  
  // Normalize team id -> display name
  const teamIdToName = useMemo(() => {
    const m = {}
    teamConfig.teams.forEach(t => { m[t.id] = t.name })
    return m
  }, [])

  const normalizeTeamId = (t) => {
    if (!t) return 'team-alpha'
    const low = t.toLowerCase().replace(/[\s]/g, '-')
    return teamConfig.teams.find(x => x.id === low || x.name.toLowerCase() === t.toLowerCase())?.id || 'team-alpha'
  }

  const initialTeamId = normalizeTeamId(user?.team || 'team-alpha')

  const [role, setRole] = useState(initialRole)
  const [userTeamId, setUserTeamId] = useState(initialTeamId)  // the locked team for 'user' role sim
  const [selectedTeamId, setSelectedTeamId] = useState(
    initialRole === 'admin' ? 'all' : initialTeamId
  )

  const managerTeamIds = useMemo(() => {
    if (!user) return []
    const base = normalizeTeamId(user.team)
    const managed = (user.managedTeams || []).map(t => normalizeTeamId(t))
    return Array.from(new Set([base, ...managed])).filter(Boolean)
  }, [user])

  // When role changes, reset team selection
  const handleRoleChange = (newRole) => {
    setRole(newRole)
    if (newRole === 'admin') {
      setSelectedTeamId('all')
    } else {
      setSelectedTeamId(userTeamId)
    }
  }

  const nodesById = useMemo(() => {
    const m = new Map()
    data.nodes.forEach(n => m.set(n.id, n))
    return m
  }, [data.nodes])

  const focusedNode = focusedId ? nodesById.get(focusedId) || null : null

  const focusedConnections = useMemo(() => {
    if (!focusedId) return []
    const conns = []
    for (const e of data.edges) {
      if (e.from === focusedId && nodesById.has(e.to)) conns.push(nodesById.get(e.to))
      else if (e.to === focusedId && nodesById.has(e.from)) conns.push(nodesById.get(e.from))
    }
    data.nodes.filter(n => n.parentId === focusedId).forEach(n => conns.push(n))
    const n = nodesById.get(focusedId)
    if (n?.parentId && nodesById.has(n.parentId)) conns.push(nodesById.get(n.parentId))
    return [...new Set(conns)]
  }, [focusedId, data, nodesById])

  // The cluster that the currently selected team owns (for manager/user auto-lock)
  const selectedTeamClusterId = useMemo(() => {
    if (selectedTeamId === 'all') return null
    return teamConfig.teams.find(t => t.id === selectedTeamId)?.clusterId || null
  }, [selectedTeamId])

  const activeNodes = useMemo(() => {
    let nodes = data.nodes.filter(n =>
      activeTab === 'decommissioned' ? n.isDecommissioned : !n.isDecommissioned
    )

    // Apply team/cluster filter based on role
    if (role === 'admin') {
      // Admin sees all — no filter needed (selectedTeamId may be 'all' or a specific team for admin view switching)
      if (selectedTeamId !== 'all') {
        const clId = teamConfig.teams.find(t => t.id === selectedTeamId)?.clusterId
        if (clId) {
          const allowed = new Set(teamConfig.clusters.find(c => c.id === clId)?.devices || [])
          nodes = nodes.filter(n => {
            const rootId = getRootId(n, nodesById)
            return allowed.has(rootId) || allowed.has(n.id)
          })
        }
      }
    } else {
      // Manager and User: filter to their team's cluster
      const clId = teamConfig.teams.find(t => t.id === selectedTeamId)?.clusterId
      if (clId) {
        const allowed = new Set(teamConfig.clusters.find(c => c.id === clId)?.devices || [])
        nodes = nodes.filter(n => {
          const rootId = getRootId(n, nodesById)
          return allowed.has(rootId) || allowed.has(n.id)
        })
      }
    }

    // Search
    if (searchQuery && activeTab !== 'decommissioned') {
      const q = searchQuery.toLowerCase()
      const matched = nodes.filter(n =>
        n.id.toLowerCase().includes(q) || n.name?.toLowerCase().includes(q)
      )
      const include = new Set(matched.map(n => n.id))
      matched.forEach(n => {
        let c = n
        while (c?.parentId) { include.add(c.parentId); c = nodesById.get(c.parentId) }
      })
      nodes = nodes.filter(n => include.has(n.id))
    }

    return nodes
  }, [data.nodes, searchQuery, activeTab, role, selectedTeamId, nodesById])

  const activeEdges = useMemo(() => {
    const ids = new Set(activeNodes.map(n => n.id))
    return data.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  }, [activeNodes, data.edges])

  const activeData = useMemo(() => ({ nodes: activeNodes, edges: activeEdges }), [activeNodes, activeEdges])

  const handleDecommission = (id) => {
    setData(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === id ? { ...n, isDecommissioned: !n.isDecommissioned } : n)
    }))
    fetch(`${apiBase}/api/ontology/nodes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDecommissioned: !nodesById.get(id)?.isDecommissioned })
    }).catch(() => {})
  }

  const handleUpdate = (id, props) => {
    setData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === id ? { ...n, ...props } : n) }))
    fetch(`${apiBase}/api/ontology/nodes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props)
    }).catch(() => {})
  }

  const handleNodeClick = (id, toggleExpand) => {
    setFocusedId(id)
    if (toggleExpand) {
      setExpandedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
    }
  }

  const handleImportConfig = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    try {
      const json = JSON.parse(text)
      if (json.nodes && json.edges) { setData(json); setShowImport(false) }
    } catch { alert('Invalid JSON configuration file') }
  }

  const handleExportConfig = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `san_topology_${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const healthStats = useMemo(() => {
    const active = activeNodes.filter(n => !n.isDecommissioned)
    return {
      total: active.length,
      normal: active.filter(n => n.status === 'normal').length,
      degraded: active.filter(n => n.status === 'degraded').length,
      failed: active.filter(n => n.status === 'failed').length,
    }
  }, [activeNodes])

  if (loading) return <div className="loading-screen"><div className="loading-spinner" /><span>Loading topology...</span></div>
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--accent-rose)' }}><h3>Error</h3><p>{error}</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            SAN Topology
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, background: 'var(--surface-1)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--line)' }}>
              <span className="pulse-dot green" /> Live DB
            </span>
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--muted)', alignItems: 'center' }}>
            <span><strong style={{ color: 'var(--foreground)' }}>{healthStats.total}</strong> Total</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-ok)' }} />{healthStats.normal}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-warn)' }} />{healthStats.degraded}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-critical)' }} />{healthStats.failed}</span>
          </div>
          <input className="input" style={{ width: 180 }} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <button className="btn" onClick={handleExportConfig}><Download size={14} />Export</button>
          <button className="btn" onClick={() => setShowImport(true)}>Import Config</button>
        </div>
      </div>

      {/* RBAC Scope Panel */}
      <div className="glass-card" style={{ display: 'flex', gap: 16, padding: '10px 16px', border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: '8px', marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>

        {/* Role Switcher (ONLY FOR ADMIN) */}
        {user?.role === 'admin' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Simulate Role:</span>
              <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
                value={role} onChange={e => handleRoleChange(e.target.value)}>
                <option value="admin">🔒 Administrator</option>
                <option value="manager">🗂️ Manager</option>
                <option value="user">👥 Team Member</option>
              </select>
            </div>
            <div style={{ height: 16, width: 1, background: 'var(--line)' }} />
          </>
        )}

        {/* Team selector — admin & manager can switch; user is locked */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Team:</span>
          {role === 'user' ? (
            <span style={{ fontSize: 11, color: '#58a6ff', background: 'rgba(58,166,255,0.1)', border: '1px solid rgba(58,166,255,0.2)', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
              🔒 {teamIdToName[selectedTeamId] || selectedTeamId}
            </span>
          ) : (role === 'manager' || user?.role === 'manager' || user?.role === 'senior_manager') ? (
            // Manager: can switch team but only among their managed teams
            <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
              value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
              {managerTeamIds.map(tid => (
                <option key={tid} value={tid}>{teamIdToName[tid] || tid}</option>
              ))}
            </select>
          ) : (
            // Admin: can pick all or specific team
            <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
              value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
              <option value="all">All Teams</option>
              {teamConfig.teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Cluster display — always read-only for manager/user, derived from their team */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cluster:</span>
          {role === 'admin' && selectedTeamId === 'all' ? (
            <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--line-strong)', padding: '4px 8px', borderRadius: 4 }}>All Clusters</span>
          ) : (
            // For all roles: cluster is auto-derived from selected team — no control for manager/user
            <span style={{ fontSize: 11, color: role === 'admin' ? 'var(--muted)' : '#58a6ff',
              background: role === 'admin' ? 'var(--line-strong)' : 'rgba(58,166,255,0.1)',
              border: role !== 'admin' ? '1px solid rgba(58,166,255,0.2)' : 'none',
              padding: '3px 8px', borderRadius: 4, fontWeight: role !== 'admin' ? 600 : 400 }}>
              {role !== 'admin' && '🔒 '}
              {teamConfig.clusters.find(c => c.id === selectedTeamClusterId)?.name || selectedTeamClusterId || '—'}
            </span>
          )}
        </div>

        {/* Role badge */}
        {role === 'user' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(88,166,255,0.1)', color: '#58a6ff', border: '1px solid rgba(88,166,255,0.2)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#58a6ff', boxShadow: '0 0 8px #58a6ff' }} />
            Team-Scoped View
          </div>
        )}
        {role === 'manager' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(210,153,34,0.1)', color: '#d29922', border: '1px solid rgba(210,153,34,0.2)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d29922', boxShadow: '0 0 8px #d29922' }} />
            Manager View
          </div>
        )}
        {role === 'admin' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(63,185,80,0.1)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.2)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', boxShadow: '0 0 8px #3fb950' }} />
            Administrator Override
          </div>
        )}
      </div>

      <div className="sub-tabs">
        <button className={`sub-tab ${activeTab === 'diagram' ? 'active' : ''}`} onClick={() => setActiveTab('diagram')}>SAN Diagram</button>
        <button className={`sub-tab ${activeTab === 'visual' ? 'active' : ''}`} onClick={() => setActiveTab('visual')}>Visual Map</button>
        <button className={`sub-tab ${activeTab === 'decommissioned' ? 'active' : ''}`} onClick={() => setActiveTab('decommissioned')}>
          Decommissioned ({data.nodes.filter(n => n.isDecommissioned).length})
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        <div className="glass-card" style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: 0 }}>
          {activeTab === 'diagram' && <SANDiagram data={activeData} focusedId={focusedId} expandedIds={expandedIds} onNodeClick={handleNodeClick} />}
          {activeTab === 'visual' && <TopologyCanvas data={activeData} onNodeClick={(id) => handleNodeClick(id, false)} />}
          {activeTab === 'decommissioned' && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              {activeNodes.length === 0 ? "No decommissioned nodes." : "Decommissioned nodes are hidden from topology views."}
            </div>
          )}
        </div>
        <div style={{ width: 340, flexShrink: 0, height: '100%' }}>
          <NodeCard node={focusedNode} connections={focusedConnections} onDecommissionToggle={handleDecommission} onUpdateNode={handleUpdate} />
        </div>
      </div>

      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div className="glass-card rise-in" onClick={e => e.stopPropagation()} style={{ padding: 32, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 16, marginBottom: 16, color: 'var(--foreground)' }}>Import Configuration</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Upload a JSON topology configuration file (nodes + edges)</p>
            <input type="file" accept=".json" onChange={handleImportConfig} className="input" />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setShowImport(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper: walk up parentId chain to find the root node id
function getRootId(node, nodesById) {
  let current = node
  while (current?.parentId && nodesById.has(current.parentId)) {
    current = nodesById.get(current.parentId)
  }
  return current?.id
}