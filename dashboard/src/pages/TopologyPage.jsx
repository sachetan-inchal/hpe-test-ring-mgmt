import { useState, useEffect, useMemo, useContext } from 'react'
import { Download } from 'lucide-react'
import * as XLSX from 'xlsx'
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
  const [selectedIds, setSelectedIds] = useState(() => new Set())
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

  const visualMapData = useMemo(() => {
    if (selectedIds.size === 0) return activeData

    const ids = selectedIds
    return {
      nodes: activeData.nodes.filter(n => ids.has(n.id)),
      edges: activeData.edges.filter(e => ids.has(e.from) && ids.has(e.to)),
    }
  }, [activeData, selectedIds])

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
      if (json.nodes && json.edges) {
        setData(json)
        setSelectedIds(new Set())
        setShowImport(false)
      }
    } catch { alert('Invalid JSON configuration file') }
  }

  const handleSelectToggle = (id, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      
      const toggleNodeAndDescendants = (nodeId) => {
        if (checked) {
          next.add(nodeId)
        } else {
          next.delete(nodeId)
        }
        data.nodes.forEach(n => {
          if (n.parentId === nodeId) {
            toggleNodeAndDescendants(n.id)
          }
        })
      }
      
      toggleNodeAndDescendants(id)
      return next
    })
  }

  const handleSelectSearchResults = () => {
    if (!searchQuery) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      activeNodes.forEach(n => {
        const q = searchQuery.toLowerCase()
        if (n.id.toLowerCase().includes(q) || n.name?.toLowerCase().includes(q) || n.type?.toLowerCase().includes(q)) {
          next.add(n.id)
          const selectDescendants = (parentId) => {
            data.nodes.forEach(child => {
              if (child.parentId === parentId) {
                next.add(child.id)
                selectDescendants(child.id)
              }
            })
          }
          selectDescendants(n.id)
        }
      })
      return next
    })
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
  }

  const exportData = useMemo(() => {
    if (selectedIds.size === 0) return data

    const allowedIds = new Set()
    
    const addNodeAndDescendants = (id) => {
      if (allowedIds.has(id)) return
      allowedIds.add(id)
      data.nodes.forEach(n => {
        if (n.parentId === id) addNodeAndDescendants(n.id)
      })
    }

    selectedIds.forEach(id => {
      // Add the node and all its descendants recursively
      addNodeAndDescendants(id)
      
      // Also walk up to parents to ensure the parent hierarchy is included
      let current = nodesById.get(id)
      while (current) {
        allowedIds.add(current.id)
        if (!current.parentId) break
        current = nodesById.get(current.parentId)
      }
    })

    const nodes = data.nodes.filter(node => allowedIds.has(node.id))
    const edges = data.edges.filter(edge => allowedIds.has(edge.from) && allowedIds.has(edge.to))

    return { nodes, edges }
  }, [data, nodesById, selectedIds])

  const handleExportConfig = () => {
    const workbook = XLSX.utils.book_new()
    const nodesSheet = XLSX.utils.json_to_sheet(exportData.nodes.map(node => ({
      id: node.id,
      name: node.name || '',
      type: node.type || '',
      status: node.status || '',
      category: node.category || '',
      parentId: node.parentId || '',
      isDecommissioned: !!node.isDecommissioned,
      model: node.model || '',
      protocol: node.protocol || '',
    })))
    const edgesSheet = XLSX.utils.json_to_sheet(exportData.edges.map(edge => ({
      from: edge.from || '',
      to: edge.to || '',
      label: edge.label || '',
    })))

    XLSX.utils.book_append_sheet(workbook, nodesSheet, 'Nodes')
    XLSX.utils.book_append_sheet(workbook, edgesSheet, 'Edges')

    XLSX.writeFile(
      workbook,
      `san_topology_${selectedIds.size > 0 ? 'selected_' : ''}${new Date().toISOString().slice(0, 10)}.xlsx`
    )
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
            Test Ring Viewer
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, background: 'var(--surface-1)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--line)' }}>
              <span className="pulse-dot green" /> Live DB
            </span>
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {user?.role === 'admin' && (
            <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--muted)', alignItems: 'center' }}>
              <span><strong style={{ color: 'var(--foreground)' }}>{healthStats.total}</strong> Total</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-ok)' }} />{healthStats.normal}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-warn)' }} />{healthStats.degraded}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-critical)' }} />{healthStats.failed}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input" style={{ width: 150 }} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery && (
              <button 
                onClick={handleSelectSearchResults}
                className="btn btn-primary"
                style={{ height: 32, padding: '0 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                title="Automatically check all items matching search query"
              >
                Select Matches
              </button>
            )}
          </div>
          {selectedIds.size > 0 && (
            <span style={{ fontSize: 11, color: 'var(--accent-blue)', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)', padding: '4px 8px', borderRadius: 999 }}>
              {selectedIds.size} selected
            </span>
          )}
          {selectedIds.size > 0 && (
            <button className="btn" onClick={handleClearSelection}>Clear Selection</button>
          )}
          <button className="btn" onClick={handleExportConfig}><Download size={14} />Export Excel</button>
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
          {activeTab === 'diagram' && <SANDiagram data={activeData} focusedId={focusedId} expandedIds={expandedIds} onNodeClick={handleNodeClick} selectedIds={selectedIds} onSelectToggle={handleSelectToggle} searchQuery={searchQuery} />}
          {activeTab === 'visual' && <TopologyCanvas data={visualMapData} onNodeClick={(id) => handleNodeClick(id, false)} />}
          {activeTab === 'decommissioned' && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              {activeNodes.length === 0 ? "No decommissioned nodes." : "Decommissioned nodes are hidden from topology views."}
            </div>
          )}
        </div>
        <div style={{ width: 340, flexShrink: 0, height: '100%' }}>
          {focusedNode ? (
            <NodeCard node={focusedNode} connections={focusedConnections} onDecommissionToggle={handleDecommission} onUpdateNode={handleUpdate} />
          ) : (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'rgba(57,197,207,0.1)', color: 'var(--accent-blue)' }}>
                  <svg style={{ width: 18, height: 18 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)' }}>Topology Overview</h3>
                  <p style={{ fontSize: 11, color: 'var(--muted)' }}>Scope metrics & batch controls</p>
                </div>
              </div>

              {/* Active Scope Summary */}
              <div style={{ background: 'var(--surface-1)', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 8 }}>Active Scope</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Current Team:</span>
                    <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                      {selectedTeamId === 'all' ? 'All Teams (Global)' : (teamIdToName[selectedTeamId] || selectedTeamId)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Scope Cluster:</span>
                    <span style={{ fontWeight: 600, color: '#58a6ff' }}>
                      {selectedTeamId === 'all' ? 'All Clusters' : (teamConfig.clusters.find(c => c.id === selectedTeamClusterId)?.name || selectedTeamClusterId || '—')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Total Devices:</span>
                    <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{healthStats.total}</span>
                  </div>
                </div>
              </div>

              {/* Selection Summary */}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 12 }}>
                  Selection Statistics
                </h4>

                {selectedIds.size === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '24px 0', border: '1px dashed var(--line)', borderRadius: 10, background: 'var(--surface-1)', color: 'var(--muted)', textAlign: 'center', minHeight: 180, marginBottom: 20 }}>
                    <svg style={{ width: 36, height: 36, opacity: 0.3, marginBottom: 10 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', marginBottom: 4 }}>No active selections</p>
                    <p style={{ fontSize: 11, padding: '0 16px', lineHeight: 1.4 }}>
                      Check items in the diagram to inspect batch statistics, invert selections, or export specific nodes.
                    </p>
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface-1)', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                        {selectedIds.size} Device{selectedIds.size > 1 ? 's' : ''} Selected
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--accent-blue)', background: 'rgba(88,166,255,0.1)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                        Active Export Set
                      </span>
                    </div>

                    {/* Progress Bar */}
                    {(() => {
                      const selectedNodesList = data.nodes.filter(n => selectedIds.has(n.id) && !n.isDecommissioned);
                      const totalSelected = selectedNodesList.length;
                      const normal = selectedNodesList.filter(n => n.status === 'normal').length;
                      const degraded = selectedNodesList.filter(n => n.status === 'degraded').length;
                      const failed = selectedNodesList.filter(n => n.status === 'failed').length;

                      const normalPercent = totalSelected > 0 ? (normal / totalSelected) * 100 : 0;
                      const degradedPercent = totalSelected > 0 ? (degraded / totalSelected) * 100 : 0;
                      const failedPercent = totalSelected > 0 ? (failed / totalSelected) * 100 : 0;

                      return (
                        <>
                          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--line-strong)', marginBottom: 14 }}>
                            <div style={{ width: `${normalPercent}%`, background: 'var(--status-ok)', transition: 'width 0.3s' }} />
                            <div style={{ width: `${degradedPercent}%`, background: 'var(--status-warn)', transition: 'width 0.3s' }} />
                            <div style={{ width: `${failedPercent}%`, background: 'var(--status-critical)', transition: 'width 0.3s' }} />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', background: 'rgba(63,185,80,0.06)', borderRadius: 6, border: '1px solid rgba(63,185,80,0.15)' }}>
                              <span style={{ color: 'var(--status-ok)', fontWeight: 600 }}>Normal</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{normal}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', background: 'rgba(210,153,34,0.06)', borderRadius: 6, border: '1px solid rgba(210,153,34,0.15)' }}>
                              <span style={{ color: 'var(--status-warn)', fontWeight: 600 }}>Degraded</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{degraded}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', background: 'rgba(248,81,73,0.06)', borderRadius: 6, border: '1px solid rgba(248,81,73,0.15)' }}>
                              <span style={{ color: 'var(--status-critical)', fontWeight: 600 }}>Failed</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{failed}</span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Batch Actions Group */}
                <div style={{ marginTop: 'auto' }}>
                  <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 12 }}>
                    ⚡ Batch Operations
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                    <button 
                      onClick={() => {
                        const next = new Set()
                        activeNodes.forEach(n => next.add(n.id))
                        setSelectedIds(next)
                      }} 
                      className="btn" 
                      style={{ fontSize: 11, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <svg style={{ width: 12, height: 12 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      Select All
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedIds(prev => {
                          const next = new Set()
                          activeNodes.forEach(n => {
                            if (!prev.has(n.id)) next.add(n.id)
                          })
                          return next
                        })
                      }} 
                      className="btn" 
                      style={{ fontSize: 11, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <svg style={{ width: 12, height: 12 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      Invert
                    </button>
                  </div>

                  <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 12 }}>
                    👁️ Layout Presentation
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button 
                      onClick={() => {
                        const parentIds = new Set()
                        activeNodes.forEach(n => {
                          if (n.parentId) parentIds.add(n.parentId)
                        })
                        setExpandedIds(Array.from(parentIds))
                      }} 
                      className="btn" 
                      style={{ fontSize: 11, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <svg style={{ width: 12, height: 12 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Expand All
                    </button>
                    <button 
                      onClick={() => setExpandedIds([])} 
                      className="btn" 
                      style={{ fontSize: 11, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <svg style={{ width: 12, height: 12 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                      </svg>
                      Collapse All
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}
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