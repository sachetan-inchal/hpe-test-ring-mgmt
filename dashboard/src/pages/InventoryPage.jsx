import { useState, useEffect, useMemo } from 'react'
import { Database, Search, ChevronRight, ChevronDown, Monitor, Cpu, HardDrive, Share2, Info, X } from 'lucide-react'

const TYPE_ICONS = {
  Array: <Database size={16} />,
  Switch: <Share2 size={16} />,
  Host: <Monitor size={16} />,
  Node: <Cpu size={16} />,
  Disk: <HardDrive size={16} />,
  PhysicalDisk: <HardDrive size={16} />,
  Cage: <Database size={16} />,
}

export default function InventoryPage({ apiBase }) {
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTypes, setExpandedTypes] = useState(['Array', 'Switch', 'Host'])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`${apiBase}/api/graph/neo4j`)
        const json = await res.json()
        const normalized = (json.nodes || []).map(n => ({
          id: n.data?.id || n.id,
          name: n.data?.name || n.name,
          type: n.data?.label || n.type,
          status: n.data?.status || 'normal',
          ...n.data
        }))
        setNodes(normalized)
      } catch (err) {
        console.error('Failed to load inventory:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [apiBase])

  const groupedNodes = useMemo(() => {
    const groups = {}
    nodes.forEach(n => {
      const t = n.type || 'Other'
      if (!groups[t]) groups[t] = []
      groups[t].push(n)
    })
    return groups
  }, [nodes])

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groupedNodes
    const q = searchQuery.toLowerCase()
    const filtered = {}
    Object.entries(groupedNodes).forEach(([type, items]) => {
      const matched = items.filter(n => 
        n.name?.toLowerCase().includes(q) || 
        n.id.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q)
      )
      if (matched.length > 0) filtered[type] = matched
    })
    return filtered
  }, [groupedNodes, searchQuery])

  const toggleType = (type) => {
    setExpandedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
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
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input className="input" style={{ width: 250, paddingLeft: 32 }} placeholder="Search inventory..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <div className="badge badge-ok">{nodes.length} Components</div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        {/* Main Content: Tables */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
          {Object.entries(filteredGroups).map(([type, items]) => (
            <div key={type} className="glass-card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
              <div onClick={() => toggleType(type)} style={{ 
                padding: '12px 16px', background: 'var(--surface-1)', borderBottom: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' 
              }}>
                {expandedTypes.includes(type) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ color: 'var(--hpe-green)', fontWeight: 600 }}>{TYPE_ICONS[type] || <Info size={16} />}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{type}s</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{items.length} items</span>
              </div>
              
              {expandedTypes.includes(type) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--line)' }}>
                      <th style={{ padding: '10px 16px', color: 'var(--muted)' }}>Name</th>
                      <th style={{ padding: '10px 16px', color: 'var(--muted)' }}>ID</th>
                      <th style={{ padding: '10px 16px', color: 'var(--muted)' }}>Status</th>
                      <th style={{ padding: '10px 16px', color: 'var(--muted)' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(node => (
                      <tr key={node.id} onClick={() => setSelectedNode(node)} className="table-row" style={{ 
                        borderBottom: '1px solid var(--line)', cursor: 'pointer',
                        background: selectedNode?.id === node.id ? 'var(--hpe-green-light)' : 'transparent'
                      }}>
                        <td style={{ padding: '10px 16px', fontWeight: 500 }}>{node.name || 'N/A'}</td>
                        <td style={{ padding: '10px 16px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{node.id}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className={`badge badge-sm ${node.status === 'normal' ? 'badge-ok' : node.status === 'degraded' ? 'badge-warn' : 'badge-crit'}`}>
                            {node.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>
                          {node.model || node.ip_address || node.serialNumber || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>

        {/* Sidebar: Details */}
        <div style={{ width: 320, display: selectedNode ? 'flex' : 'none', flexDirection: 'column' }}>
          <div className="glass-card rise-in" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Properties</h3>
              <button onClick={() => setSelectedNode(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--hpe-green)' }}>
                  {TYPE_ICONS[selectedNode?.type] || <Info size={20} />}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedNode?.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{selectedNode?.type}</div>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedNode && Object.entries(selectedNode)
                  .filter(([k]) => !['id', 'name', 'type', 'category', 'parentId', 'isDecommissioned', 'focused', 'onClick', 'label'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                      <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 2 }}>{k.replace(/_/g, ' ')}</label>
                      <div style={{ fontSize: 13, color: 'var(--foreground)' }}>{String(v)}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
