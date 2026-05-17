import { useState, useEffect, useMemo, useContext } from 'react'
import { Download } from 'lucide-react'
import TopologyCanvas from '../components/TopologyCanvas'
import SANDiagram from '../components/SANDiagram'
import NodeCard from '../components/NodeCard'
import { AuthContext } from '../context/AuthContext'

export default function TopologyPage({ apiBase }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [focusedId, setFocusedId] = useState(null)
  const [expandedIds, setExpandedIds] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('diagram')
  const [showImport, setShowImport] = useState(false)

  // Fetch topology from backend
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const fetchWithData = async (url, timeoutMs = 4500) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
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
          `${apiBase}/api/ontology/topology`,
          `${apiBase}/api/graph/neo4j`,
          `${apiBase}/api/sim/mock-topology`,
        ]
        const localResults = await Promise.all(localSources.map(url => fetchWithData(url)))
        let json = localResults.find(Boolean)
        if (!json) json = await fetchWithData(`https://hpe-ontology-and-graph.onrender.com/topology`)
        
        if (!json) throw new Error('Failed to load topology from any source or databases are empty')
        
        // Normalize: Neo4j format has nodes[].data / edges[].data
        if (json.nodes?.[0]?.data) {
          setData({
            nodes: json.nodes.map(n => ({ id: n.data.id, name: n.data.name || n.data.id, type: n.data.label || 'Unknown', status: n.data.status || 'normal', category: n.data.category || 'main', parentId: n.data.parentId || null, isDecommissioned: false, ...n.data })),
            edges: json.edges.map(e => ({ from: e.data.source, to: e.data.target, label: e.data.label || '' }))
          })
        } else {
          setData(json)
        }
      } catch (err) { setError(err.message) } finally { setLoading(false) }
    }
    load()
  }, [apiBase])

  const { user } = useContext(AuthContext)

  // Normalize team names for visual consistency, e.g. team-alpha -> Team-Alpha
  const normalizeTeamName = (t) => {
    if (!t) return 'Team-Alpha';
    const low = t.toLowerCase();
    if (low === 'team-alpha') return 'Team-Alpha';
    if (low === 'team-beta') return 'Team-Beta';
    if (low === 'all teams' || low === 'all') return 'All Teams';
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  const initialRole = user?.role === 'admin' ? 'admin' : 'user';
  const initialTeam = normalizeTeamName(user?.team || 'Team-Alpha');

  const [role, setRole] = useState(initialRole) // 'admin' or 'user'
  const [userTeam, setUserTeam] = useState(initialTeam) // User role locked team
  const [selectedTeam, setSelectedTeam] = useState(initialRole === 'admin' ? 'All Teams' : initialTeam) // Admin chosen team or default locked
  const [selectedCluster, setSelectedCluster] = useState('All Clusters') // Cluster filter

  const nodesById = useMemo(() => { const m = new Map(); data.nodes.forEach(n => m.set(n.id, n)); return m }, [data.nodes])
  const focusedNode = focusedId ? nodesById.get(focusedId) || null : null

  // Dynamically compute clusters associated with the active team
  const availableClusters = useMemo(() => {
    const activeTeam = role === 'user' ? userTeam : selectedTeam;
    const clusters = new Set();
    data.nodes.forEach(n => {
      let current = n;
      while (current?.parentId && nodesById.has(current.parentId)) {
        current = nodesById.get(current.parentId);
      }
      if (current && current.cluster) {
        if (activeTeam === 'All Teams' || current.team === activeTeam) {
          clusters.add(current.cluster);
        }
      }
    });
    return Array.from(clusters).sort();
  }, [data.nodes, role, userTeam, selectedTeam, nodesById]);

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

  const activeNodes = useMemo(() => {
    const activeTeam = role === 'user' ? userTeam : selectedTeam;
    
    // Decommissioned filter
    let nodes = data.nodes.filter(n => activeTab === 'decommissioned' ? n.isDecommissioned : !n.isDecommissioned)

    // Team & Cluster filter
    nodes = nodes.filter(n => {
      let current = n;
      while (current?.parentId && nodesById.has(current.parentId)) {
        current = nodesById.get(current.parentId);
      }

      if (activeTeam !== 'All Teams') {
        if (current && current.team && current.team !== activeTeam) {
          return false;
        }
      }

      if (selectedCluster !== 'All Clusters') {
        if (current && current.cluster && current.cluster !== selectedCluster) {
          return false;
        }
      }

      return true;
    });

    // Search query filter
    if (searchQuery && activeTab !== 'decommissioned') {
      const q = searchQuery.toLowerCase()
      const matched = nodes.filter(n => n.id.toLowerCase().includes(q) || n.name?.toLowerCase().includes(q))
      const include = new Set(matched.map(n => n.id))
      matched.forEach(n => { let c = n; while (c?.parentId) { include.add(c.parentId); c = nodesById.get(c.parentId) } })
      nodes = nodes.filter(n => include.has(n.id))
    }
    return nodes
  }, [data.nodes, searchQuery, activeTab, role, userTeam, selectedTeam, selectedCluster, nodesById])

  const activeEdges = useMemo(() => {
    const ids = new Set(activeNodes.map(n => n.id))
    return data.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  }, [activeNodes, data.edges])

  const activeData = useMemo(() => ({ nodes: activeNodes, edges: activeEdges }), [activeNodes, activeEdges])

  const handleDecommission = (id) => {
    setData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === id ? { ...n, isDecommissioned: !n.isDecommissioned } : n) }))
    fetch(`${apiBase}/api/ontology/nodes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDecommissioned: !nodesById.get(id)?.isDecommissioned }) }).catch(() => {})
  }

  const handleUpdate = (id, props) => {
    setData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === id ? { ...n, ...props } : n) }))
    fetch(`${apiBase}/api/ontology/nodes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) }).catch(() => {})
  }

  const handleNodeClick = (id, toggleExpand) => { 
    setFocusedId(id); 
    if (toggleExpand) {
      setExpandedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]) 
    }
  }

  // Import config
  const handleImportConfig = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    try {
      const json = JSON.parse(text)
      if (json.nodes && json.edges) { setData(json); setShowImport(false) }
    } catch { alert('Invalid JSON configuration file') }
  }

  // Export config
  const handleExportConfig = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `san_topology_${new Date().toISOString().slice(0,10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const healthStats = useMemo(() => {
    const active = activeNodes.filter(n => !n.isDecommissioned)
    return { total: active.length, normal: active.filter(n => n.status === 'normal').length,
      degraded: active.filter(n => n.status === 'degraded').length, failed: active.filter(n => n.status === 'failed').length }
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

      {/* RBAC Multi-Tenant Scope Panel */}
      <div className="glass-card" style={{ display: 'flex', gap: 16, padding: '10px 16px', border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: '8px', marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>User Role:</span>
          <select className="input" style={{ width: 130, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }} value={role} onChange={e => {
            const newRole = e.target.value;
            setRole(newRole);
            if (newRole === 'user') {
              setSelectedTeam(userTeam);
            } else {
              setSelectedTeam('All Teams');
            }
            setSelectedCluster('All Clusters');
          }}>
            <option value="admin">🔒 Administrator</option>
            <option value="user">👥 Team Member</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Simulate User:</span>
          {role === 'user' ? (
            <select className="input" style={{ width: 130, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }} value={userTeam} onChange={e => {
              const nt = e.target.value;
              setUserTeam(nt);
              setSelectedTeam(nt);
              setSelectedCluster('All Clusters');
            }}>
              <option value="Team-Alpha">Team-Alpha User</option>
              <option value="Team-Beta">Team-Beta User</option>
            </select>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--line-strong)', padding: '4px 8px', borderRadius: 4 }}>
              Admin Bypass (All)
            </span>
          )}
        </div>

        <div style={{ height: 16, width: 1, background: 'var(--line)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Team Workspace:</span>
          {role === 'admin' ? (
            <select className="input" style={{ width: 130, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }} value={selectedTeam} onChange={e => {
              setSelectedTeam(e.target.value);
              setSelectedCluster('All Clusters');
            }}>
              <option value="All Teams">All Teams</option>
              <option value="Team-Alpha">Team-Alpha</option>
              <option value="Team-Beta">Team-Beta</option>
            </select>
          ) : (
            <span style={{ fontSize: 11, color: '#58a6ff', background: 'rgba(58, 166, 255, 0.1)', border: '1px solid rgba(58, 166, 255, 0.2)', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
              Locked: {userTeam}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cluster:</span>
          <select className="input" style={{ width: 130, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }} value={selectedCluster} onChange={e => setSelectedCluster(e.target.value)}>
            <option value="All Clusters">All Clusters</option>
            {availableClusters.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {role === 'user' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(88, 166, 255, 0.1)', color: '#58a6ff', border: '1px solid rgba(88, 166, 255, 0.2)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#58a6ff', boxShadow: '0 0 8px #58a6ff' }} />
            Multi-Tenant Isolation Engaged
          </div>
        )}
        {role === 'admin' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(63, 185, 80, 0.1)', color: '#3fb950', border: '1px solid rgba(63, 185, 80, 0.2)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', boxShadow: '0 0 8px #3fb950' }} />
            Administrator Override Access
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
          {activeTab === 'diagram' && (
            <SANDiagram 
              data={activeData} 
              focusedId={focusedId} 
              expandedIds={expandedIds} 
              onNodeClick={handleNodeClick} 
            />
          )}
          {activeTab === 'visual' && (
            <TopologyCanvas 
              data={activeData} 
              onNodeClick={(id) => handleNodeClick(id, false)} 
            />
          )}
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
