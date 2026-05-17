import { useState, useEffect, useMemo, useContext } from 'react'
import { Search } from 'lucide-react'
import HierarchyTree from '../components/HierarchyTree'
import NodeCard from '../components/NodeCard'
import SearchBar from '../components/SearchBar'
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

export default function InventoryPage({ apiBase }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const fetchWithData = async (url) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4500);
          try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) return null;
            const data = await res.json();
            if (!data.nodes || data.nodes.length === 0) return null;
            return data;
          } catch {
            return null;
          } finally {
            clearTimeout(timer);
          }
        };

        const localSources = [
          `${apiBase}/api/graph/neo4j`,
          `${apiBase}/api/ontology/topology`,
          `${apiBase}/api/sim/mock-topology`,
        ]
        const localResults = await Promise.all(localSources.map(url => fetchWithData(url)))
        let json = localResults.find(Boolean)
        if (!json) json = await fetchWithData(`https://hpe-ontology-and-graph.onrender.com/topology`)
        
        if (!json) throw new Error('Failed to load inventory from any source or databases are empty')
        
        const normalizedNodes = (json.nodes || []).map(n => ({
          id: n.data?.id || n.id,
          name: n.data?.name || n.name,
          type: n.data?.label || n.type,
          status: n.data?.status || n.status || 'normal',
          category: n.data?.category || n.category || 'main',
          ...n.data,
          ...n // fallback for flat structure
        }))
        
        const normalizedEdges = (json.edges || []).map(e => ({
          from: e.data?.source || e.source || e.from,
          to: e.data?.target || e.target || e.to,
          label: e.data?.label || e.label || ''
        }))
        
        setData({ nodes: normalizedNodes, edges: normalizedEdges })
        const arrays = normalizedNodes.filter(n => n.type === 'Array').map(n => n.id)
        setExpandedIds(arrays)

      } catch (err) {
        console.error('Inventory load failed', err)
      } finally {
        setLoading(false)
      }

    }
    load()
  }, [apiBase])

  const { user } = useContext(AuthContext)

  // Roles: 'admin', 'manager', 'user'
  const initialRole = user?.role === 'admin' ? 'admin' : user?.role === 'manager' ? 'manager' : 'user'
  
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

  // The cluster that the currently selected team owns (for manager/user auto-lock)
  const selectedTeamClusterId = useMemo(() => {
    if (selectedTeamId === 'all') return null
    return teamConfig.teams.find(t => t.id === selectedTeamId)?.clusterId || null
  }, [selectedTeamId])

  const activeNodes = useMemo(() => {
    let nodes = data.nodes

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

    return nodes
  }, [data.nodes, role, selectedTeamId, nodesById])

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return activeNodes
    const q = searchQuery.toLowerCase()
    return activeNodes.filter(n => 
      n.name?.toLowerCase().includes(q) || 
      n.id.toLowerCase().includes(q) ||
      n.type?.toLowerCase().includes(q)
    )
  }, [activeNodes, searchQuery])

  const visibleIds = useMemo(() => filteredNodes.map(n => n.id), [filteredNodes])
  
  const rootIds = useMemo(() => {
    // Top-level arrays or independent switches
    return activeNodes.filter(n => n.category === 'main').map(n => n.id)
  }, [activeNodes])

  const selectedNode = useMemo(() => activeNodes.find(n => n.id === selectedNodeId) || null, [activeNodes, selectedNodeId])
  
  const connectedNodes = useMemo(() => {
    if (!selectedNodeId) return []
    const conns = []
    const nodesByIdMap = new Map()
    activeNodes.forEach(n => nodesByIdMap.set(n.id, n))
    
    for (const e of data.edges) {
      if (e.from === selectedNodeId && nodesByIdMap.has(e.to)) conns.push(nodesByIdMap.get(e.to))
      else if (e.to === selectedNodeId && nodesByIdMap.has(e.from)) conns.push(nodesByIdMap.get(e.from))
    }
    return [...new Set(conns)]
  }, [selectedNodeId, activeNodes, data.edges])

  const handleNodeClick = (id) => {
    setSelectedNodeId(id)
    setExpandedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  if (loading) return <div className="loading-screen"><div className="loading-spinner" /><span>Loading Inventory...</span></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Resource Inventory</h2>
          <p className="page-subtitle">Hierarchical view of all discovered SAN components</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
          <div className="badge badge-ok">{activeNodes.length} Components</div>
        </div>
      </div>

      {/* RBAC Scope Panel */}
      <div className="glass-card" style={{ display: 'flex', gap: 16, padding: '10px 16px', border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: '8px', marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>

        {/* Role Switcher */}
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

        {/* Team selector — admin & manager can switch; user is locked */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Team:</span>
          {role === 'user' ? (
            <span style={{ fontSize: 11, color: '#58a6ff', background: 'rgba(58,166,255,0.1)', border: '1px solid rgba(58,166,255,0.2)', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
              🔒 {teamIdToName[selectedTeamId] || selectedTeamId}
            </span>
          ) : role === 'manager' ? (
            // Manager: can switch team but not cluster
            <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
              value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
              {teamConfig.teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
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

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <HierarchyTree 
            nodes={activeNodes} 
            edges={data.edges} 
            visibleIds={visibleIds} 
            expandedIds={expandedIds} 
            focusedId={selectedNodeId}
            rootIds={rootIds}
            onNodeClick={handleNodeClick}
          />
        </div>

        <div style={{ width: 340, display: selectedNode ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <NodeCard 
            node={selectedNode} 
            connections={connectedNodes} 
            onUpdateNode={(id, props) => {
              setData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === id ? { ...n, ...props } : n) }))
              fetch(`${apiBase}/api/ontology/nodes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) }).catch(() => {})
            }}
          />
        </div>
      </div>
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