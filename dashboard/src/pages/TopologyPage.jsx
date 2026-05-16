import { useState, useEffect, useMemo } from 'react'
import { Download } from 'lucide-react'
import TopologyCanvas from '../components/TopologyCanvas'
import SANDiagram from '../components/SANDiagram'
import NodeCard from '../components/NodeCard'

export default function TopologyPage({ apiBase }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [focusedId, setFocusedId] = useState(null)
  const [expandedIds, setExpandedIds] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('diagram')
  const [showImport, setShowImport] = useState(false)

  // Fetch topology from backend (tries ontology endpoint, falls back to Neo4j)
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        let res = await fetch(`${apiBase}/api/ontology/topology`)
        if (!res.ok) res = await fetch(`${apiBase}/api/graph/neo4j`)
        if (!res.ok) throw new Error('Failed to load topology')
        const json = await res.json()
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

  const nodesById = useMemo(() => { const m = new Map(); data.nodes.forEach(n => m.set(n.id, n)); return m }, [data.nodes])
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

  const activeNodes = useMemo(() => {
    let nodes = data.nodes.filter(n => activeTab === 'decommissioned' ? n.isDecommissioned : !n.isDecommissioned)
    if (searchQuery && activeTab !== 'decommissioned') {
      const q = searchQuery.toLowerCase()
      const matched = nodes.filter(n => n.id.toLowerCase().includes(q) || n.name?.toLowerCase().includes(q))
      const include = new Set(matched.map(n => n.id))
      matched.forEach(n => { let c = n; while (c?.parentId) { include.add(c.parentId); c = nodesById.get(c.parentId) } })
      nodes = nodes.filter(n => include.has(n.id))
    }
    return nodes
  }, [data.nodes, searchQuery, activeTab, nodesById])

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
    const active = data.nodes.filter(n => !n.isDecommissioned)
    return { total: active.length, normal: active.filter(n => n.status === 'normal').length,
      degraded: active.filter(n => n.status === 'degraded').length, failed: active.filter(n => n.status === 'failed').length }
  }, [data.nodes])

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
