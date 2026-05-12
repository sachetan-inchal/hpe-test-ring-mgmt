import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import TopologyCanvas from './components/TopologyCanvas'
import AggregateSidebar from './components/AggregateSidebar'
import DiscoveryPanel from './components/DiscoveryPanel'
import NodeTerminal from './components/NodeTerminal'
import SearchBar from './components/SearchBar'
import StatusBar from './components/StatusBar'
import ChatPanel from './components/ChatPanel'
import RadialMenu from './components/RadialMenu'
import AdminPanel from './components/AdminPanel'
import FieldManager from './components/FieldManager'

const API = ''

export default function App() {
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [selectedNode, setSelectedNode] = useState(null)
  const [terminalNode, setTerminalNode] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [discoveryRunning, setDiscoveryRunning] = useState(false)
  const [discoveryEvents, setDiscoveryEvents] = useState([])
  const [discoveryPane, setDiscoveryPane] = useState(false)
  const [highlightedIps, setHighlightedIps] = useState(new Set())
  const [pulsingIds, setPulsingIds] = useState(new Set())

  const [apiHealth, setApiHealth] = useState(null)
  const eventSourceRef = useRef(null)

  const [chatOpen, setChatOpen] = useState(false)
  const [chatSeed, setChatSeed] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [fieldOpen, setFieldOpen] = useState(false)
  const [pickMode, setPickMode] = useState(false)
  const [isolateEnabled, setIsolateEnabled] = useState(false)
  const [isolateSelected, setIsolateSelected] = useState(() => new Set())

  const toggleIsolateId = useCallback((id) => {
    setIsolateSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/graph/neo4j`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const nodes = (data.nodes || []).map(n => ({
        id: n.data.id,
        name: n.data.name || n.data.label || n.data.id,
        type: n.data.label || 'Unknown',
        status: n.data.status || 'normal',
        ip: n.data.ip_address || '',
        ...n.data
      }))
      const edges = (data.edges || []).map(e => ({
        id: `${e.data.source}-${e.data.target}`,
        from: e.data.source,
        to: e.data.target,
        label: e.data.label || ''
      }))
      setGraph({ nodes, edges })
    } catch {
      try {
        const simRes = await fetch(`${API}/api/sim/topology`)
        const simData = await simRes.json()
        setGraph({
          nodes: (simData.nodes || []).map(n => ({
            ...n,
            type: n.type || 'Device',
            status: 'normal',
            ip: n.id
          })),
          edges: (simData.edges || []).map(e => ({
            id: `${e.source}-${e.target}`,
            from: e.source,
            to: e.target,
            label: e.type || ''
          }))
        })
      } catch { /* no-op */ }
    }
  }, [])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/health`)
      const data = await res.json()
      setApiHealth(data)
    } catch {
      setApiHealth(null)
    }
  }, [])

  useEffect(() => {
    fetchGraph()
    fetchHealth()
    const interval = setInterval(() => { fetchHealth() }, 10000)
    return () => clearInterval(interval)
  }, [fetchGraph, fetchHealth])

  const startDiscovery = async (seedIps, delayMs = 20) => {
    setDiscoveryEvents([])
    setDiscoveryRunning(true)
    setDiscoveryPane(true)
    setHighlightedIps(new Set())
    setPulsingIds(new Set())

    try {
      await fetch(`${API}/api/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_ips: seedIps, delay_ms: delayMs })
      })
    } catch (e) {
      console.error('Discovery start failed:', e)
      setDiscoveryRunning(false)
      return
    }

    if (eventSourceRef.current) eventSourceRef.current.close()
    const es = new EventSource(`${API}/api/discover/stream`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      setDiscoveryEvents(prev => [...prev, event])

      if (event.ip) {
        setHighlightedIps(prev => new Set([...prev, event.ip]))
      }
      if (event.type === 'parsed' && event.ip) {
        setPulsingIds(prev => new Set([...prev, event.ip]))
        window.setTimeout(() => {
          setPulsingIds(prev => {
            const next = new Set(prev)
            next.delete(event.ip)
            return next
          })
        }, 2200)
        setGraph(prev => {
          const exists = prev.nodes.find(n => n.ip === event.ip)
          if (exists) return prev
          const newNode = {
            id: event.ip,
            name: event.device_name || event.ip,
            type: event.device_type === 'hpe_array' ? 'Array'
              : event.device_type === 'linux_host' ? 'Host'
              : event.device_type === 'windows_host' ? 'Host'
              : 'Device',
            status: 'normal',
            ip: event.ip,
            entity_counts: event.entity_counts
          }
          return { nodes: [...prev.nodes, newNode], edges: prev.edges }
        })
      }
      if (event.type === 'discovered_ip' && event.ip && event.source) {
        setGraph(prev => {
          const edgeId = `${event.source}-${event.ip}`
          const exists = prev.edges.find(e => e.id === edgeId)
          if (exists) return prev
          return {
            nodes: prev.nodes,
            edges: [...prev.edges, { id: edgeId, from: event.source, to: event.ip, label: 'discovered' }]
          }
        })
      }
      if (event.type === 'complete' || event.type === 'error') {
        setDiscoveryRunning(false)
        es.close()
        fetchGraph()
      }
    }
    es.onerror = () => {
      setDiscoveryRunning(false)
      es.close()
    }
  }

  const searchFilteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return graph.nodes
    const q = searchQuery.toLowerCase()
    return graph.nodes.filter(n =>
      n.name?.toLowerCase().includes(q) ||
      n.ip?.toLowerCase().includes(q) ||
      n.type?.toLowerCase().includes(q) ||
      n.model?.toLowerCase()?.includes(q)
    )
  }, [graph.nodes, searchQuery])

  const displayNodes = useMemo(() => {
    if (isolateEnabled && isolateSelected.size > 0) {
      const sel = isolateSelected
      const neighbor = new Set(sel)
      for (const e of graph.edges) {
        if (sel.has(e.from)) neighbor.add(e.to)
        if (sel.has(e.to)) neighbor.add(e.from)
      }
      return graph.nodes.filter(n => neighbor.has(n.id))
    }
    return searchFilteredNodes
  }, [graph.nodes, graph.edges, isolateEnabled, isolateSelected, searchFilteredNodes])

  const displayEdges = useMemo(() => {
    const ids = new Set(displayNodes.map(n => n.id))
    return graph.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  }, [displayNodes, graph.edges])

  const stats = {
    arrays:   graph.nodes.filter(n => n.type === 'Array' || n.type === 'ArraySystem').length,
    switches: graph.nodes.filter(n => n.type === 'Switch').length,
    hosts:    graph.nodes.filter(n => n.type === 'Host').length,
    drives:   graph.nodes.filter(n => n.type === 'PhysicalDisk').length,
  }

  const consumeChatSeed = useCallback(() => setChatSeed(null), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        gap: 16,
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em',
            color: 'var(--foreground)',
          }}>
            <span style={{ color: 'var(--accent-blue)' }}>HPE</span>
            <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 6, fontSize: 14 }}>
              SAN Discovery Platform
            </span>
          </div>
          {discoveryRunning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-blue)', fontSize: 12 }}>
              <span className="pulse-dot blue" />
              Discovery running...
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            pickMode={pickMode}
            onPickModeChange={setPickMode}
            isolateEnabled={isolateEnabled}
            onIsolateEnabled={setIsolateEnabled}
            candidates={searchFilteredNodes}
            isolateSelected={isolateSelected}
            onToggleIsolateId={toggleIsolateId}
          />
          <RadialMenu
            onPickPrompt={(q) => { setChatOpen(true); setChatSeed(q) }}
            disabled={false}
          />
          <button
            type="button"
            className={`btn ${chatOpen ? 'btn-primary' : ''}`}
            onClick={() => setChatOpen(o => !o)}
          >
            AI Assistant
          </button>
          <button type="button" className="btn" onClick={() => setFieldOpen(true)}>Fields</button>
          <button type="button" className="btn" onClick={() => setAdminOpen(true)}>Admin</button>
          <button
            className={`btn ${discoveryRunning ? '' : 'btn-primary'}`}
            disabled={discoveryRunning}
            onClick={() => startDiscovery(['10.20.10.5'])}
          >
            {discoveryRunning ? '⟳ Scanning...' : '▶ Start Discovery'}
          </button>
          <button
            className={`btn ${discoveryPane ? 'btn-primary' : ''}`}
            onClick={() => setDiscoveryPane(p => !p)}
          >
            Discovery Log
          </button>
          <button className="btn" onClick={fetchGraph} title="Refresh graph">↺</button>
        </div>
      </header>

      <StatusBar stats={stats} apiHealth={apiHealth} discoveryEvents={discoveryEvents} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <TopologyCanvas
            nodes={displayNodes}
            edges={displayEdges}
            selectedNode={selectedNode}
            onNodeClick={node => {
              setSelectedNode(node)
              setTerminalNode(null)
            }}
            highlightedIps={highlightedIps}
            discoveryRunning={discoveryRunning}
            pulsingIds={pulsingIds}
          />
        </div>

        <AggregateSidebar
          node={selectedNode}
          allNodes={graph.nodes}
          allEdges={graph.edges}
          onOpenTerminal={node => setTerminalNode(node)}
          onClose={() => setSelectedNode(null)}
          apiBase={API}
        />

        {chatOpen && (
          <ChatPanel
            apiBase={API}
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            seedMessage={chatSeed}
            onConsumedSeed={consumeChatSeed}
          />
        )}

        {discoveryPane && (
          <DiscoveryPanel
            events={discoveryEvents}
            running={discoveryRunning}
            onClose={() => setDiscoveryPane(false)}
            onStartDiscovery={startDiscovery}
          />
        )}
      </div>

      {terminalNode && (
        <NodeTerminal
          node={terminalNode}
          apiBase={API}
          onClose={() => setTerminalNode(null)}
        />
      )}

      <AdminPanel
        apiBase={API}
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        selectedNode={selectedNode}
        allNodes={graph.nodes}
        onGraphChanged={fetchGraph}
      />

      <FieldManager
        apiBase={API}
        open={fieldOpen}
        onClose={() => setFieldOpen(false)}
      />
    </div>
  )
}
