import { useState, useEffect, useMemo } from 'react'
import { Search } from 'lucide-react'
import HierarchyTree from '../components/HierarchyTree'
import NodeCard from '../components/NodeCard'
import SearchBar from '../components/SearchBar'

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
        let res = await fetch(`${apiBase}/api/graph/neo4j`).catch(() => ({ ok: false }))
        if (!res.ok) res = await fetch(`${apiBase}/api/ontology/topology`).catch(() => ({ ok: false }))
        if (!res.ok) res = await fetch(`${apiBase}/api/sim/mock-topology`).catch(() => ({ ok: false }))
        if (!res.ok) res = await fetch(`https://hpe-ontology-and-graph.onrender.com/topology`).catch(() => ({ ok: false }))
        if (!res.ok) throw new Error('Failed to load inventory from any source')
        
        const json = await res.json()
        
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
        
        // Expand top level components by default
        const arrays = normalizedNodes.filter(n => n.type === 'Array').map(n => n.id)
        setExpandedIds(arrays)
      } catch (err) {
        console.error('Failed to load inventory:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [apiBase])

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return data.nodes
    const q = searchQuery.toLowerCase()
    return data.nodes.filter(n => 
      n.name?.toLowerCase().includes(q) || 
      n.id.toLowerCase().includes(q) ||
      n.type?.toLowerCase().includes(q)
    )
  }, [data.nodes, searchQuery])

  const visibleIds = useMemo(() => filteredNodes.map(n => n.id), [filteredNodes])
  
  const rootIds = useMemo(() => {
    // Top-level arrays or independent switches
    return data.nodes.filter(n => n.category === 'main').map(n => n.id)
  }, [data.nodes])

  const selectedNode = useMemo(() => data.nodes.find(n => n.id === selectedNodeId) || null, [data.nodes, selectedNodeId])
  
  const connectedNodes = useMemo(() => {
    if (!selectedNodeId) return []
    const conns = []
    const nodesById = new Map()
    data.nodes.forEach(n => nodesById.set(n.id, n))
    
    for (const e of data.edges) {
      if (e.from === selectedNodeId && nodesById.has(e.to)) conns.push(nodesById.get(e.to))
      else if (e.to === selectedNodeId && nodesById.has(e.from)) conns.push(nodesById.get(e.from))
    }
    return [...new Set(conns)]
  }, [selectedNodeId, data])

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
          <div className="badge badge-ok">{data.nodes.length} Components</div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <HierarchyTree 
            nodes={data.nodes} 
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
