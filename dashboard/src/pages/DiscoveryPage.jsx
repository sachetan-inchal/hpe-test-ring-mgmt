import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import TopologyCanvas from '../components/TopologyCanvas'
import AggregateSidebar from '../components/AggregateSidebar'
import DiscoveryPanel from '../components/DiscoveryPanel'
import DiscoveryResultGrid from '../components/DiscoveryResultGrid'
import NeuralGraph from '../components/NeuralGraph'
import NodeTerminal from '../components/NodeTerminal'
import StatusBar from '../components/StatusBar'
import { LayoutGrid, Network, Zap } from 'lucide-react'

export default function DiscoveryPage({ apiBase }) {
  const API = apiBase || ''
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [selectedNode, setSelectedNode] = useState(null)
  const [terminalNode, setTerminalNode] = useState(null)
  const [discoveryRunning, setDiscoveryRunning] = useState(false)
  const [discoveryEvents, setDiscoveryEvents] = useState([])
  const [discoveryPane, setDiscoveryPane] = useState(false)
  const [viewMode, setViewMode] = useState('graph') // 'graph', 'grid', 'neural'
  const [highlightedIps, setHighlightedIps] = useState(new Set())
  const [pulsingIds, setPulsingIds] = useState(new Set())
  const [apiHealth, setApiHealth] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const eventSourceRef = useRef(null)

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/graph/neo4j`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const nodes = (data.nodes || []).map(n => ({
        id: n.data.id, name: n.data.name || n.data.label || n.data.id,
        type: n.data.label || 'Unknown', status: n.data.status || 'normal',
        ip: n.data.ip_address || '', ...n.data
      }))
      const edges = (data.edges || []).map(e => ({
        id: `${e.data.source}-${e.data.target}`, from: e.data.source,
        to: e.data.target, label: e.data.label || ''
      }))
      setGraph({ nodes, edges })
    } catch {
      try {
        const simRes = await fetch(`${API}/api/sim/topology`)
        const simData = await simRes.json()
        setGraph({
          nodes: (simData.nodes || []).map(n => ({ ...n, type: n.type || 'Device', status: 'normal', ip: n.id })),
          edges: (simData.edges || []).map(e => ({ id: `${e.source}-${e.target}`, from: e.source, to: e.target, label: e.type || '' }))
        })
      } catch {}
    }
  }, [API])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/health`)
      setApiHealth(await res.json())
    } catch { setApiHealth(null) }
  }, [API])

  useEffect(() => {
    fetchGraph(); fetchHealth()
    const interval = setInterval(fetchHealth, 10000)
    return () => clearInterval(interval)
  }, [fetchGraph, fetchHealth])

  const startDiscovery = async (seedIps, delayMs = 5) => {
    setDiscoveryEvents([]); setDiscoveryRunning(true); setDiscoveryPane(true)
    setHighlightedIps(new Set()); setPulsingIds(new Set())
    try {
      await fetch(`${API}/api/discover`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_ips: seedIps, delay_ms: delayMs })
      })
    } catch { setDiscoveryRunning(false); return }

    if (eventSourceRef.current) eventSourceRef.current.close()
    const es = new EventSource(`${API}/api/discover/stream`)
    eventSourceRef.current = es
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      setDiscoveryEvents(prev => [...prev, event])
      if (event.ip) setHighlightedIps(prev => new Set([...prev, event.ip]))
      if (event.type === 'parsed' && event.ip) {
        setPulsingIds(prev => new Set([...prev, event.ip]))
        setTimeout(() => setPulsingIds(prev => { const n = new Set(prev); n.delete(event.ip); return n }), 2200)
        setGraph(prev => {
          if (prev.nodes.find(n => n.ip === event.ip)) return prev
          return { nodes: [...prev.nodes, {
            id: event.ip, name: event.device_name || event.ip,
            type: event.device_type === 'hpe_array' ? 'Array' : event.device_type === 'linux_host' ? 'Host' : 'Device',
            status: 'normal', ip: event.ip, entity_counts: event.entity_counts
          }], edges: prev.edges }
        })
      }
      if (event.type === 'discovered_ip' && event.ip && event.source && event.source !== "null") {
        setGraph(prev => {
          const edgeId = `${event.source}-${event.ip}`
          if (prev.edges.find(e => e.id === edgeId)) return prev
          return {
            ...prev,
            edges: [...prev.edges, { id: edgeId, from: event.source, to: event.ip, label: 'LINK' }]
          }
        })
      }
      if (event.type === 'complete' || event.type === 'error') { setDiscoveryRunning(false); es.close(); fetchGraph() }
    }
    es.onerror = () => { setDiscoveryRunning(false); es.close() }
  }

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return graph.nodes
    const q = searchQuery.toLowerCase()
    return graph.nodes.filter(n => n.name?.toLowerCase().includes(q) || n.ip?.toLowerCase().includes(q) || n.type?.toLowerCase().includes(q))
  }, [graph.nodes, searchQuery])

  const filteredEdges = useMemo(() => {
    const ids = new Set(filteredNodes.map(n => n.id))
    return graph.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  }, [filteredNodes, graph.edges])

  const stats = {
    arrays: graph.nodes.filter(n => n.type === 'Array' || n.type === 'ArraySystem').length,
    switches: graph.nodes.filter(n => n.type === 'Switch').length,
    hosts: graph.nodes.filter(n => n.type === 'Host').length,
    drives: graph.nodes.filter(n => n.type === 'PhysicalDisk').length,
  }

  const wipeGraph = async () => {
    if (!window.confirm("This will clear the entire topology graph. Continue?")) return
    try {
      await fetch(`${API}/api/graph/wipe`, { method: 'POST' })
      setGraph({ nodes: [], edges: [] })
      setSelectedNode(null)
    } catch (e) { console.error("Wipe failed", e) }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    
    setDiscoveryEvents([]); setDiscoveryRunning(true); setDiscoveryPane(true)
    try {
      const res = await fetch(`${API}/api/discover/ingest`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.ip) startDiscovery([data.ip], 150) // Slower delay for better "expansion" feel
    } catch (err) { setDiscoveryRunning(false); alert("Upload failed") }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Controls bar */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Network Discovery</h2>
          <p className="page-subtitle">BFS crawler scans simulated SAN topology in real-time</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="sub-tabs" style={{ marginBottom: 0, marginRight: 8 }}>
            <button className={`sub-tab ${viewMode === 'graph' ? 'active' : ''}`} onClick={() => setViewMode('graph')} title="Topology Graph">
              <Network size={16} />
            </button>
            <button className={`sub-tab ${viewMode === 'neural' ? 'active' : ''}`} onClick={() => setViewMode('neural')} title="Neural View">
              <Zap size={16} />
            </button>
            <button className={`sub-tab ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Card Grid">
              <LayoutGrid size={16} />
            </button>
          </div>
          <input className="input" style={{ width: 120 }} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          
          <button className="btn" onClick={wipeGraph} title="Clear all nodes">🗑 Wipe</button>
          
          <label className="btn" style={{ cursor: 'pointer' }}>
            📁 Log
            <input type="file" accept=".txt" style={{ display: 'none' }} onChange={handleFileUpload} />
          </label>

          <button className={`btn ${discoveryRunning ? '' : 'btn-primary'}`} disabled={discoveryRunning} onClick={() => startDiscovery(['10.20.10.5'])}>
            {discoveryRunning ? '⟳ Scanning...' : '▶ Start Discovery'}
          </button>
          <button className={`btn ${discoveryPane ? 'btn-primary' : ''}`} onClick={() => setDiscoveryPane(p => !p)}>Log</button>
          <button className="btn" onClick={fetchGraph}>↺</button>
        </div>
      </div>

      <StatusBar stats={stats} apiHealth={apiHealth} discoveryEvents={discoveryEvents} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflowY: viewMode === 'grid' ? 'auto' : 'hidden', padding: viewMode === 'grid' ? '0 24px' : 0 }}>
          {viewMode === 'graph' ? (
            <TopologyCanvas nodes={filteredNodes} edges={filteredEdges} selectedNode={selectedNode}
              onNodeClick={node => { setSelectedNode(node); setTerminalNode(null) }}
              highlightedIps={highlightedIps} discoveryRunning={discoveryRunning} pulsingIds={pulsingIds} />
          ) : viewMode === 'neural' ? (
            <NeuralGraph nodes={filteredNodes} edges={filteredEdges} onNodeClick={node => { setSelectedNode(node); setTerminalNode(null) }} />
          ) : (
            <DiscoveryResultGrid nodes={filteredNodes} onNodeClick={node => { setSelectedNode(node); setTerminalNode(null) }} />
          )}
        </div>
        <AggregateSidebar node={selectedNode} allNodes={graph.nodes} allEdges={graph.edges}
          onOpenTerminal={node => setTerminalNode(node)} onClose={() => setSelectedNode(null)} apiBase={API} />
        {discoveryPane && (
          <DiscoveryPanel events={discoveryEvents} running={discoveryRunning}
            onClose={() => setDiscoveryPane(false)} onStartDiscovery={startDiscovery} />
        )}
      </div>
      {terminalNode && <NodeTerminal node={terminalNode} apiBase={API} onClose={() => setTerminalNode(null)} />}
    </div>
  )
}
