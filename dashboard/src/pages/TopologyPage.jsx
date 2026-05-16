import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { Search, Download, Image, Trash2, Plus, ChevronDown, ChevronRight, X, Database, Edit2, Eye, EyeOff, Filter } from 'lucide-react'

const API_BASE = '/api/ontology'

// ==== Custom Node ====
function SanNode({ data }) {
  const colors = { Array: '#58a6ff', Switch: '#bc8cff', Host: '#3fb950', JBOF: '#e3a042', Disk: '#39c5cf', Port: '#d29922', Node: '#58a6ff', Cage: '#e3a042', SwitchPort: '#bc8cff', HostPort: '#3fb950', PCI_Device: '#39c5cf' }
  const statusColors = { normal: '#3fb950', degraded: '#d29922', failed: '#f85149', offline: '#484f58' }
  const c = colors[data.type] || '#58a6ff'
  const sc = statusColors[data.status] || '#484f58'
  return (
    <div onClick={data.onClick} style={{
      background: `linear-gradient(135deg, ${c}15, ${c}08)`, border: `1.5px solid ${c}60`,
      borderRadius: 10, padding: '8px 12px', minWidth: 120, cursor: 'pointer', position: 'relative',
      boxShadow: data.focused ? `0 0 16px ${c}40` : 'none', transition: 'box-shadow 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</span>
      </div>
      <div style={{ fontSize: 9.5, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{data.type}</div>
      {data.isDecommissioned && <div style={{ position: 'absolute', top: -6, right: -6, fontSize: 8, background: '#f85149', color: 'white', padding: '1px 5px', borderRadius: 8, fontWeight: 700 }}>OFF</div>}
    </div>
  )
}

const nodeTypes = { sanNode: SanNode }

// ==== Node Detail Card ====
function NodeCard({ node, connections, onDecommission, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [editValues, setEditValues] = useState({})

  if (!node) return (
    <div className="glass-card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Click a node to view details
    </div>
  )

  const startEdit = () => { setEditValues({ name: node.name, status: node.status }); setEditing(true) }
  const saveEdit = () => { onUpdate(node.id, editValues); setEditing(false) }

  const statusColors = { normal: 'var(--status-ok)', degraded: 'var(--status-warn)', failed: 'var(--status-critical)' }
  const fields = Object.entries(node).filter(([k]) => !['id','type','category','parentId','isDecommissioned','name','status'].includes(k))

  return (
    <div className="glass-card rise-in" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {editing ? <input className="input" value={editValues.name} onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))} style={{ width: 160, marginBottom: 4 }} />
            : <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)' }}>{node.name}</h3>}
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <span className={`badge ${node.status === 'normal' ? 'badge-ok' : node.status === 'degraded' ? 'badge-warn' : 'badge-crit'}`}>{node.status}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{node.type}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {editing ? <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button> : <button className="btn btn-sm" onClick={startEdit}><Edit2 size={12} />Edit</button>}
          <button className="btn btn-danger btn-sm" onClick={() => onDecommission(node.id)}>
            {node.isDecommissioned ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </div>
      <div style={{ padding: '12px 20px', maxHeight: 300, overflowY: 'auto', fontSize: 12 }}>
        {fields.map(([k, v]) => v != null && (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</span>
            <span style={{ color: 'var(--foreground)', fontFamily: typeof v === 'number' ? 'var(--font-mono)' : 'inherit' }}>{String(v)}</span>
          </div>
        ))}
      </div>
      {connections.length > 0 && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Connected ({connections.length})</div>
          {connections.slice(0, 8).map(c => (
            <div key={c.id} style={{ fontSize: 11, color: 'var(--muted)', padding: '3px 0' }}>• {c.name} <span style={{ color: 'var(--line-strong)' }}>({c.type})</span></div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==== Main Topology Page ====
export default function TopologyPage({ apiBase }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [focusedId, setFocusedId] = useState(null)
  const [expandedIds, setExpandedIds] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('topology')
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
    let nodes = data.nodes.filter(n => activeTab === 'topology' ? !n.isDecommissioned : n.isDecommissioned)
    if (searchQuery && activeTab === 'topology') {
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

  // React Flow nodes/edges
  // --- Dagre Layout ---
  const getLayoutedElements = useCallback((nodes, edges, direction = 'TB') => {
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))
    dagreGraph.setGraph({ rankdir: direction, ranksep: 100, nodesep: 80 })

    nodes.forEach((node) => dagreGraph.setNode(node.id, { width: 180, height: 40 }))
    edges.forEach((edge) => dagreGraph.setEdge(edge.from, edge.to))

    dagre.layout(dagreGraph)

    return nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id)
      return {
        ...node,
        position: { x: nodeWithPosition.x - 90, y: nodeWithPosition.y - 20 }
      }
    })
  }, [])

  // React Flow nodes/edges
  const rfNodes = useMemo(() => {
    const laid = getLayoutedElements(activeNodes, activeEdges)
    return laid.map(n => ({
      id: n.id, type: 'sanNode', position: n.position,
      data: { ...n, label: n.name, focused: n.id === focusedId, onClick: () => handleNodeClick(n.id) }
    }))
  }, [activeNodes, activeEdges, focusedId, getLayoutedElements])

  const rfEdges = useMemo(() => activeEdges.map((e, i) => ({
    id: `e-${i}`, source: e.from, target: e.to, label: e.label,
    style: { stroke: 'var(--line-strong)', strokeWidth: 1.5 }, animated: e.label === 'ISL',
    labelStyle: { fill: 'var(--muted)', fontSize: 9 }
  })), [activeEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges)
  useEffect(() => { setNodes(rfNodes) }, [rfNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges])

  const handleDecommission = (id) => {
    setData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === id ? { ...n, isDecommissioned: !n.isDecommissioned } : n) }))
    fetch(`${apiBase}/api/ontology/nodes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDecommissioned: !nodesById.get(id)?.isDecommissioned }) }).catch(() => {})
  }

  const handleUpdate = (id, props) => {
    setData(prev => ({ ...prev, nodes: prev.nodes.map(n => n.id === id ? { ...n, ...props } : n) }))
    fetch(`${apiBase}/api/ontology/nodes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) }).catch(() => {})
  }

  const handleNodeClick = (id) => { setFocusedId(id); setExpandedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]) }

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
        <button className={`sub-tab ${activeTab === 'topology' ? 'active' : ''}`} onClick={() => setActiveTab('topology')}>SAN Diagram</button>
        <button className={`sub-tab ${activeTab === 'decommissioned' ? 'active' : ''}`} onClick={() => setActiveTab('decommissioned')}>
          Decommissioned ({data.nodes.filter(n => n.isDecommissioned).length})
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        <div className="glass-card" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}
            style={{ background: 'var(--background)' }} minZoom={0.3} maxZoom={2.5}>
            <Background color="var(--line)" gap={20} size={1} />
            <Controls />
            <MiniMap style={{ background: 'var(--surface-1)', border: '1px solid var(--line)' }} nodeColor={n => {
              const c = { Array: '#58a6ff', Switch: '#bc8cff', Host: '#3fb950' }; return c[n.data?.type] || '#484f58'
            }} />
          </ReactFlow>
        </div>
        <div style={{ width: 340, flexShrink: 0, overflowY: 'auto' }}>
          <NodeCard node={focusedNode} connections={focusedConnections} onDecommission={handleDecommission} onUpdate={handleUpdate} />
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
