import { useState, useEffect, useMemo, useContext } from 'react'
import { Search, Database, Layers, Network, Activity, Zap, Play } from 'lucide-react'
import HierarchyTree from '../components/HierarchyTree'
import NodeCard from '../components/NodeCard'
import SearchBar from '../components/SearchBar'
import { AuthContext } from '../context/AuthContext'

const SIM_DEVICE_IDS = [
  "ARR-01", "SW-01", "HOST-01", "ARR-04", "SW-04", "HOST-04", "SW-ETH-01", "SW-SAS-01", "SW-MONGO-NEW",
  "ARR-02", "SW-02", "HOST-02", "ARR-B03", "SW-B03", "HOST-B03", "SW-IB-01",
  "ARR-03", "SW-03", "HOST-03", "ARR-B04", "SW-B04", "HOST-B04", "SW-FCOE-01"
];

function isVirtualNode(node, deviceKindMap) {
  if (!node) return false;
  if (node.device_kind === 'mock' || node.is_mock === true || node.virtual === true) return true;
  if (node.device_kind === 'real') return false;
  
  const nameKey = node.name || node.id;
  if (deviceKindMap && nameKey in deviceKindMap) {
    return deviceKindMap[nameKey] === 'mock';
  }
  if (deviceKindMap && node.id in deviceKindMap) {
    return deviceKindMap[node.id] === 'mock';
  }
  if (deviceKindMap && node.ip && node.ip in deviceKindMap) {
    return deviceKindMap[node.ip] === 'mock';
  }
  if (deviceKindMap && node.ip_address && node.ip_address in deviceKindMap) {
    return deviceKindMap[node.ip_address] === 'mock';
  }
  
  if (SIM_DEVICE_IDS.includes(node.id) || SIM_DEVICE_IDS.includes(nameKey)) {
    return true;
  }
  return false;
}

export default function InventoryPage({ apiBase, deviceKindMap }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState([])
  const [selectedSource, setSelectedSource] = useState('all')
  const [sources, setSources] = useState([])
  
  // Tab control: 'hierarchy' or 'flow'
  const [activeTab, setActiveTab] = useState('hierarchy')
  
  // Data Flow Visualizer state
  const [selectedFlowHost, setSelectedFlowHost] = useState('')
  const [selectedFlowArray, setSelectedFlowArray] = useState('')

  // Fetch ingestion sources on mount
  useEffect(() => {
    async function fetchSources() {
      try {
        const res = await fetch(`${apiBase}/api/ontology/sources`)
        if (res.ok) {
          const data = await res.json()
          setSources(data.sources || [])
        }
      } catch (err) {
        console.error("Failed to fetch ontology sources", err)
      }
    }
    fetchSources()
  }, [apiBase])

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
            if (!data.nodes) return null;
            return data;
          } catch {
            return null;
          } finally {
            clearTimeout(timer);
          }
        };

        let json = null
        const suffix = '?real=true'
        if (selectedSource === 'all') {
          json = await fetchWithData(`${apiBase}/api/graph/mongo${suffix}`)
        } else {
          json = await fetchWithData(`${apiBase}/api/ontology/topology?source=${selectedSource}&real=true`)
        }
        
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
  }, [apiBase, selectedSource])

  const { user } = useContext(AuthContext)

  const [allTeamsList, setAllTeamsList] = useState([])

  useEffect(() => {
    if (apiBase) {
      fetch(`${apiBase}/api/teams`)
        .then(r => r.json())
        .then(d => {
          if (d.teams && Array.isArray(d.teams)) {
            setAllTeamsList(d.teams.map(t => ({
              id: t.id || t.name?.toLowerCase().replace(/ /g, '-'),
              name: t.name,
              manager_name: t.manager_name
            })))
          }
        })
        .catch(() => {})
    }
  }, [apiBase])

  // Normalize team id -> display name
  const teamIdToName = useMemo(() => {
    const m = {}
    allTeamsList.forEach(t => { m[t.id] = t.name })
    return m
  }, [allTeamsList])

  const normalizeTeamId = (t) => {
    if (!t) return t || ''
    const low = t.toLowerCase().replace(/[\s]/g, '-')
    return allTeamsList.find(x => x.id === low || x.name?.toLowerCase() === t.toLowerCase())?.id || low
  }

  const initialTeamId = user?.team ? normalizeTeamId(user.team) : ''

  // Roles: 'admin', 'manager', 'user'
  const initialRole = user?.role === 'admin' ? 'admin' : (user?.role === 'manager' || user?.role === 'director' || user?.role === 'senior_manager') ? 'manager' : 'user'

  const [role, setRole] = useState(initialRole)
  const [userTeamId, setUserTeamId] = useState(initialTeamId)  
  const [selectedTeamId, setSelectedTeamId] = useState(
    initialRole === 'admin' ? 'all' : initialTeamId
  )

  const handleRoleChange = (newRole) => {
    setRole(newRole)
    if (newRole === 'admin') {
      setSelectedTeamId('all')
    } else {
      setSelectedTeamId(userTeamId)
    }
  }

  // Sync initial values when user or allTeamsList changes
  useEffect(() => {
    if (user && allTeamsList.length > 0) {
      const normId = normalizeTeamId(user.team)
      setUserTeamId(normId)
      if (role !== 'admin') {
        setSelectedTeamId(normId)
      }
    }
  }, [user, allTeamsList])

  // Build ID lookup map for fast traversal
  const nodesById = useMemo(() => {
    const m = new Map()
    data.nodes.forEach(n => m.set(n.id, n))
    return m
  }, [data.nodes])

  // Strict Team-based / Cluster-based RBAC filter
  const activeNodes = useMemo(() => {
    let nodes = data.nodes

    const userTeamName = allTeamsList.find(t => t.id === userTeamId)?.name || user?.team || ''

    if (role === 'admin') {
      if (selectedTeamId !== 'all') {
        const selectedTeamName = allTeamsList.find(t => t.id === selectedTeamId)?.name || ''
        nodes = nodes.filter(n => {
          const tName = n.team || n.owner_team || ''
          return tName.toLowerCase() === selectedTeamName.toLowerCase()
        })
      }
    } else if (role === 'user') {
      nodes = nodes.filter(n => {
        const tName = n.team || n.owner_team || ''
        return tName.toLowerCase() === userTeamName.toLowerCase()
      })
    } else if (role === 'manager') {
      const managedNames = new Set(
        (user?.managedTeams || [user?.team]).filter(Boolean).map(t => t.toLowerCase())
      )
      if (selectedTeamId && selectedTeamId !== 'all') {
        const selectedTeamName = allTeamsList.find(t => t.id === selectedTeamId)?.name || ''
        nodes = nodes.filter(n => {
          const tName = n.team || n.owner_team || ''
          return tName.toLowerCase() === selectedTeamName.toLowerCase()
        })
      } else {
        nodes = nodes.filter(n => {
          const tName = (n.team || n.owner_team || '').toLowerCase()
          return managedNames.has(tName)
        })
      }
    }

    return nodes
  }, [data.nodes, role, selectedTeamId, userTeamId, allTeamsList, user, deviceKindMap])

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

  // Data Flow visualizer derived datasets
  const flowHosts = useMemo(() => activeNodes.filter(n => n.type === 'Host'), [activeNodes])
  const flowArrays = useMemo(() => activeNodes.filter(n => n.type === 'Array'), [activeNodes])
  
  // Automatically select default flow endpoints if none selected
  useEffect(() => {
    if (flowHosts.length > 0 && !selectedFlowHost) {
      setSelectedFlowHost(flowHosts[0].id)
    }
    if (flowArrays.length > 0 && !selectedFlowArray) {
      setSelectedFlowArray(flowArrays[0].id)
    }
  }, [flowHosts, flowArrays, selectedFlowHost, selectedFlowArray])

  // Resolve the active path switches and ports
  const activeFlowTraced = useMemo(() => {
    if (!selectedFlowHost || !selectedFlowArray) return null
    
    // Find switches connected to selected Host
    const connectedSwitches = new Set()
    
    for (const e of data.edges) {
      if ((e.from === selectedFlowHost || e.to === selectedFlowHost)) {
        const peer = e.from === selectedFlowHost ? e.to : e.from
        const peerNode = nodesById.get(peer)
        if (peerNode?.type === 'Switch') {
          connectedSwitches.add(peer)
        }
      }
    }
    
    // If empty, find active switches in the network
    if (connectedSwitches.size === 0) {
      activeNodes.filter(n => n.type === 'Switch').forEach(s => connectedSwitches.add(s.id))
    }
    
    // Disks inside selected Array
    const childDisks = activeNodes.filter(n => n.parentId === selectedFlowArray && n.type === 'Disk')
    
    return {
      host: nodesById.get(selectedFlowHost),
      switches: Array.from(connectedSwitches).map(id => nodesById.get(id)).filter(Boolean),
      array: nodesById.get(selectedFlowArray),
      disks: childDisks
    }
  }, [selectedFlowHost, selectedFlowArray, data.edges, activeNodes, nodesById])

  if (loading) return <div className="loading-screen"><div className="loading-spinner" /><span>Loading Inventory...</span></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--foreground)' }}>
      {/* Controls Bar */}
      <div className="page-header">
        <div>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Resource Inventory
            <span style={{ fontSize: 10, background: 'var(--surface-1)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--line)' }}>
              {activeNodes.length} Components
            </span>
          </h2>
          <p className="page-subtitle">Interactive scale-optimized hierarchy and path flow maps</p>
        </div>
        
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Sub-tabs selector */}
          <div className="sub-tabs" style={{ marginBottom: 0 }}>
            <button className={`sub-tab ${activeTab === 'hierarchy' ? 'active' : ''}`} onClick={() => setActiveTab('hierarchy')}>
              <Database size={14} style={{ marginRight: 6 }} /> Directory
            </button>
            <button className={`sub-tab ${activeTab === 'flow' ? 'active' : ''}`} onClick={() => setActiveTab('flow')}>
              <Zap size={14} style={{ marginRight: 6 }} /> Data Flow Map
            </button>
          </div>
          
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      {/* RBAC Scope Panel */}
      {(user?.role === 'admin' || user?.role === 'manager') && (
        <div className="glass-card" style={{ display: 'flex', gap: 16, padding: '10px 16px', border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: '8px', marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Team Scope:</span>
            {role === 'user' ? (
              <span style={{ fontSize: 11, color: '#58a6ff', background: 'rgba(58,166,255,0.1)', border: '1px solid rgba(58,166,255,0.2)', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
                🔒 {teamIdToName[selectedTeamId] || user?.team || selectedTeamId}
              </span>
            ) : role === 'manager' ? (
              <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
                value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                {allTeamsList.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            ) : (
              <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
                value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                <option value="all">All Teams</option>
                {allTeamsList.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        
        {activeTab === 'hierarchy' ? (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <HierarchyTree 
                nodes={filteredNodes} 
                edges={data.edges} 
                visibleIds={visibleIds} 
                expandedIds={expandedIds} 
                focusedId={selectedNodeId}
                rootIds={rootIds}
                onNodeClick={handleNodeClick}
              />
            </div>
          </div>
        ) : (
          /* Premium Interactive Data Flow Visualizer */
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            
            {/* Flow selection panels */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 24, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>SELECT HOST INITIATOR</label>
                <select className="input" style={{ width: '100%' }} value={selectedFlowHost} onChange={e => setSelectedFlowHost(e.target.value)}>
                  {flowHosts.map(h => (
                    <option key={h.id} value={h.id}>{h.name} ({h.id})</option>
                  ))}
                </select>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 16 }}>
                <Zap size={20} className="animate-pulse" style={{ color: 'var(--hpe-green)' }} />
              </div>
              
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>SELECT STORAGE TARGET</label>
                <select className="input" style={{ width: '100%' }} value={selectedFlowArray} onChange={e => setSelectedFlowArray(e.target.value)}>
                  {flowArrays.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Traced Flow Diagram */}
            {activeFlowTraced ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* SVG path mapping */}
                <div style={{ display: 'flex', flex: 1, position: 'relative', border: '1px solid var(--line)', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '24px 16px', minHeight: 360 }}>
                  
                  {/* Left: Host Node card */}
                  <div style={{ width: '20%', display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 10 }}>
                    <div className="glass-card" style={{ padding: 12, border: '1px solid #58a6ff', background: 'rgba(88,166,255,0.05)', textAlign: 'center', borderRadius: 8, cursor: 'pointer' }}
                      onClick={() => setSelectedNodeId(activeFlowTraced.host.id)}>
                      <Database size={24} style={{ color: '#58a6ff', marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{activeFlowTraced.host.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>HOST INITIATOR</div>
                      <div style={{ fontSize: 10, marginTop: 4, background: 'rgba(88,166,255,0.1)', padding: '2px 6px', borderRadius: 10 }}>{activeFlowTraced.host.osType || 'Linux'}</div>
                    </div>
                  </div>

                  {/* Spacer 1 */}
                  <div style={{ width: '10%' }} />

                  {/* Interconnecting animated SVG lines using a responsive 100x100 viewBox coordinate system */}
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    <defs>
                      <style>{`
                        .flow-line-1 {
                          stroke: #58a6ff;
                          stroke-width: 1.2;
                          fill: none;
                          stroke-linecap: round;
                          opacity: 0.85;
                        }
                        .flow-line-2 {
                          stroke: #3fb950;
                          stroke-width: 1.2;
                          fill: none;
                          stroke-linecap: round;
                          opacity: 0.85;
                        }
                        .flow-pulse-1 {
                          stroke: #c8e1ff;
                          stroke-width: 1.2;
                          stroke-dasharray: 2, 4;
                          animation: flowDash 1.5s linear infinite;
                        }
                        .flow-pulse-2 {
                          stroke: #aff5b4;
                          stroke-width: 1.2;
                          stroke-dasharray: 2, 4;
                          animation: flowDash 1.5s linear infinite;
                        }
                        @keyframes flowDash {
                          to {
                            stroke-dashoffset: -10;
                          }
                        }
                      `}</style>
                    </defs>
                    
                    {/* Paths from Host -> Switches */}
                    {activeFlowTraced.switches.map((sw, idx) => {
                      const swY = (100 / (activeFlowTraced.switches.length + 1)) * (idx + 1)
                      return (
                        <g key={`sw-${idx}`}>
                          <path className="flow-line-1" d={`M 20 50 C 25 50, 25 ${swY}, 30 ${swY}`} />
                          <path className="flow-line-1 flow-pulse-1" d={`M 20 50 C 25 50, 25 ${swY}, 30 ${swY}`} />
                        </g>
                      )
                    })}

                    {/* Paths from Switches -> Array Target */}
                    {activeFlowTraced.switches.map((sw, idx) => {
                      const swY = (100 / (activeFlowTraced.switches.length + 1)) * (idx + 1)
                      return (
                        <g key={`arr-${idx}`}>
                          <path className="flow-line-2" d={`M 50 ${swY} C 55 ${swY}, 55 50, 60 50`} />
                          <path className="flow-line-2 flow-pulse-2" d={`M 50 ${swY} C 55 ${swY}, 55 50, 60 50`} />
                        </g>
                      )
                    })}
                  </svg>

                  {/* Middle: Switch Node card */}
                  <div style={{ width: '20%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, zIndex: 10 }}>
                    {activeFlowTraced.switches.map((sw, idx) => (
                      <div key={sw.id} className="glass-card" style={{ padding: 12, border: '1px solid var(--hpe-green)', background: 'rgba(1,169,130,0.05)', textAlign: 'center', borderRadius: 8, cursor: 'pointer', maxWidth: 160, alignSelf: 'center', width: '100%' }}
                        onClick={() => setSelectedNodeId(sw.id)}>
                        <Network size={20} style={{ color: 'var(--hpe-green)', marginBottom: 6 }} />
                        <div style={{ fontWeight: 600, fontSize: 12, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{sw.name}</div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>FIBRE CHANNEL SW</div>
                        <div style={{ fontSize: 9, marginTop: 4, color: '#3fb950' }}>{sw.status === 'normal' ? '🟢 Online' : '🔴 Offline'}</div>
                      </div>
                    ))}
                  </div>

                  {/* Spacer 2 */}
                  <div style={{ width: '10%' }} />

                  {/* Right: Storage Array target card */}
                  <div style={{ width: '20%', display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 10 }}>
                    <div className="glass-card" style={{ padding: 12, border: '1px solid #3fb950', background: 'rgba(63,185,80,0.05)', textAlign: 'center', borderRadius: 8, cursor: 'pointer' }}
                      onClick={() => setSelectedNodeId(activeFlowTraced.array.id)}>
                      <Database size={24} style={{ color: '#3fb950', marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{activeFlowTraced.array.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>STORAGE ARRAY</div>
                      <div style={{ fontSize: 10, marginTop: 4, background: 'rgba(63,185,80,0.1)', padding: '2px 6px', borderRadius: 10 }}>{activeFlowTraced.array.model || 'HPE 3PAR'}</div>
                    </div>
                  </div>

                  {/* Far Right: Disks list within the Storage Array (scalable display) */}
                  <div style={{ width: '20%', borderLeft: '1px solid var(--line)', paddingLeft: 16, display: 'flex', flexDirection: 'column', minHeight: 0, justifyContent: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>PHYSICAL DISKS ({activeFlowTraced.disks.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 200, paddingRight: 4 }}>
                      {activeFlowTraced.disks.slice(0, 10).map(d => (
                        <div key={d.id} className="glass-card" style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                          onClick={() => setSelectedNodeId(d.id)}>
                          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{d.name}</span>
                          <span style={{ fontSize: 8, color: d.status === 'normal' ? '#3fb950' : '#da3633' }}>●</span>
                        </div>
                      ))}
                      {activeFlowTraced.disks.length > 10 && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', marginTop: 4 }}>
                          + {activeFlowTraced.disks.length - 10} more drives
                        </div>
                      )}
                      {activeFlowTraced.disks.length === 0 && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>No disks reported.</div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>
                <span style={{ color: 'var(--muted)' }}>Select active host and array endpoints to trace active connection flow.</span>
              </div>
            )}

          </div>
        )}

        {/* Selected Node Details Card */}
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

function getRootId(node, nodesById) {
  let current = node
  while (current?.parentId && nodesById.has(current.parentId)) {
    current = nodesById.get(current.parentId)
  }
  return current?.id
}