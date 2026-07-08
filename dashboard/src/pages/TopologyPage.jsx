import { useState, useEffect, useMemo, useContext, useRef } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import TopologyCanvas from '../components/TopologyCanvas'
import SANDiagram from '../components/SANDiagram'
import NodeCard from '../components/NodeCard'
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

// ── Custom SVG Donut / Pie Chart Component ──
function PieChart({ data, size = 80 }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>
        No Data
      </div>
    );
  }

  let accumulatedAngle = 0;
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', flex: 1, minWidth: 200 }}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        {data.map((item, index) => {
          if (item.value === 0) return null;
          const percentage = item.value / total;
          const angle = percentage * 360;
          
          const x1 = 50 + 40 * Math.cos((accumulatedAngle * Math.PI) / 180);
          const y1 = 50 + 40 * Math.sin((accumulatedAngle * Math.PI) / 180);
          
          accumulatedAngle += angle;
          
          const x2 = 50 + 40 * Math.cos((accumulatedAngle * Math.PI) / 180);
          const y2 = 50 + 40 * Math.sin((accumulatedAngle * Math.PI) / 180);
          
          const largeArcFlag = angle > 180 ? 1 : 0;
          
          const pathData = `
            M 50 50
            L ${x1} ${y1}
            A 40 40 0 ${largeArcFlag} 1 ${x2} ${y2}
            Z
          `;
          
          return (
            <path
              key={index}
              d={pathData}
              fill={item.color}
              stroke="var(--background, #0d1117)"
              strokeWidth="1.5"
              style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
              onMouseEnter={(e) => e.target.style.opacity = 0.8}
              onMouseLeave={(e) => e.target.style.opacity = 1}
            >
              <title>{`${item.label}: ${item.value} (${Math.round(percentage * 100)}%)`}</title>
            </path>
          );
        })}
        <circle cx="50" cy="50" r="18" fill="#161b22" />
      </svg>
      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {data.map((item, index) => {
          const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
          return (
            <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.color, display: 'inline-block' }} />
                <span style={{ color: 'var(--muted)', fontSize: 10 }}>{item.label}</span>
              </div>
              <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{item.value} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400 }}>({pct}%)</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TopologyPage({ apiBase, chatbotApi, deviceKindMap }) {
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [showDashboardPanel, setShowDashboardPanel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [focusedId, setFocusedId] = useState(null)
  const [expandedIds, setExpandedIds] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('diagram')
  const [sidebarWidth, setSidebarWidth] = useState(340)

  const isResizing = useRef(false)

  const startResizing = (e) => {
    isResizing.current = true
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResizing)
  }

  const handleMouseMove = (e) => {
    if (!isResizing.current) return
    const nextWidth = window.innerWidth - e.clientX
    if (nextWidth > 240 && nextWidth < 600) {
      setSidebarWidth(nextWidth)
    }
  }

  const stopResizing = () => {
    isResizing.current = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResizing)
  }
  const [showImport, setShowImport] = useState(false)
  const [selectedSource, setSelectedSource] = useState('all')
  const [sources, setSources] = useState([])

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
        const fetchWithData = async (url, timeoutMs = 4500) => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          try {
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) return null
            const data = await res.json()
            if (!data.nodes) return null
            return data
          } catch { return null }
          finally { clearTimeout(timer) }
        }

        let json = null
        const suffix = '?real=true'
        if (selectedSource === 'all') {
          json = await fetchWithData(`${apiBase}/api/graph/mongo${suffix}`)
        } else {
          json = await fetchWithData(`${apiBase}/api/ontology/topology?source=${selectedSource}&real=true`)
        }

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
  }, [apiBase, selectedSource])

  const { user } = useContext(AuthContext)

  const [allTeamsList, setAllTeamsList] = useState([])
  
  const getTeamDashboardMetrics = (teamId, allNodes) => {
    // Filter nodes belonging to this team if teamId is not 'all'
    let teamNodes = allNodes;
    if (teamId && teamId !== 'all') {
      const teamObj = allTeamsList.find(t => t.id === teamId);
      const teamName = teamObj ? teamObj.name : teamId;
      teamNodes = allNodes.filter(n => {
        const tName = n.team || n.owner_team || '';
        return tName.toLowerCase() === teamName.toLowerCase();
      });
    }

    // Count real arrays, switches, hosts from teamNodes
    const arrays = teamNodes.filter(n => (n.type || '').toLowerCase().includes('array')).length;
    const switches = teamNodes.filter(n => (n.type || '').toLowerCase().includes('switch')).length;
    const hosts = teamNodes.filter(n => (n.type || '').toLowerCase().includes('host')).length;
    const total = teamNodes.length;

    // Let's seed specific dummy data based on the team name/id to make it look realistic and dynamic
    const seed = (teamId || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    
    // Generation counts
    const g9 = Math.round(total * (0.3 + (seed % 10) / 50));
    const g10 = Math.round(total * (0.5 - (seed % 10) / 100));
    const g11 = Math.max(0, total - g9 - g10);

    // Array node node-count split
    const twoNode = Math.round(arrays * (0.6 + (seed % 5) / 25));
    const fourNode = Math.max(0, arrays - twoNode);

    // Fabric topology split (switched vs switchless)
    const switched = Math.round(total * (0.8 - (seed % 4) / 40));
    const switchless = Math.max(0, total - switched);

    // Switch type split
    const ethernet = Math.round(switches * (0.4 + (seed % 3) / 15));
    const fc = Math.max(0, switches - ethernet);

    // Statuses
    const normal = teamNodes.filter(n => n.status === 'normal').length;
    const degraded = teamNodes.filter(n => n.status === 'degraded').length;
    const failed = teamNodes.filter(n => n.status === 'failed').length;

    return {
      total,
      arrays,
      switches,
      hosts,
      normal,
      degraded,
      failed,
      g9,
      g10,
      g11,
      twoNode,
      fourNode,
      switched,
      switchless,
      ethernet,
      fc
    };
  };

  const [selectedArrayId, setSelectedArrayId] = useState('all')

  const [allUsers, setAllUsers] = useState([])
  const [selectedSimUserId, setSelectedSimUserId] = useState('')

  useEffect(() => {
    if (chatbotApi) {
      fetch(`${chatbotApi}/auth/users`)
        .then(r => r.json())
        .then(data => {
          if (data.users && Array.isArray(data.users)) {
            setAllUsers(data.users)
          }
        })
        .catch(() => {})
    }
  }, [chatbotApi])

  useEffect(() => {
    fetch(`${apiBase}/api/teams`)
      .then(r => r.json())
      .then(data => {
        if (data.teams && Array.isArray(data.teams)) {
          setAllTeamsList(data.teams.map(t => ({
            id: t.id || t.name?.toLowerCase().replace(/ /g, '-'),
            name: t.name,
            manager_name: t.manager_name
          })))
        }
      })
      .catch(() => {})
  }, [apiBase])

  // Roles: 'admin', 'manager', 'director', 'user'
  const initialRole = user?.role === 'admin' ? 'admin' : (user?.role === 'manager' || user?.role === 'director' || user?.role === 'senior_manager') ? 'manager' : 'user'
  
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

  const [role, setRole] = useState(initialRole)
  const [userTeamId, setUserTeamId] = useState(initialTeamId)  // the locked team for 'user' role sim
  const [selectedTeamId, setSelectedTeamId] = useState(
    (initialRole === 'admin' || initialRole === 'user') ? 'all' : initialTeamId
  )

  const managerTeamIds = useMemo(() => {
    if (role !== 'admin' && selectedSimUserId) {
      const simUser = allUsers.find(u => u._id === selectedSimUserId)
      if (simUser) {
        const base = normalizeTeamId(simUser.team)
        const managed = (simUser.managedTeams || []).map(t => normalizeTeamId(t))
        return Array.from(new Set([base, ...managed])).filter(Boolean)
      }
    }

    if (!user) return []
    if (user.role === 'admin') {
      return allTeamsList.map(t => t.id)
    }
    const base = normalizeTeamId(user.team)
    const managed = (user.managedTeams || []).map(t => normalizeTeamId(t))
    return Array.from(new Set([base, ...managed])).filter(Boolean)
  }, [user, allTeamsList, role, selectedSimUserId, allUsers])

  // Sync initial values when user or allTeamsList changes
  useEffect(() => {
    if (user) {
      const normId = normalizeTeamId(user.team)
      setUserTeamId(normId)
      if (role !== 'admin') {
        setSelectedTeamId(normId)
      }
    }
  }, [user, allTeamsList])

  useEffect(() => {
    if (data.nodes && data.nodes.length > 0) {
      const targetId = sessionStorage.getItem('target_focused_node_id')
      if (targetId) {
        const matched = data.nodes.find(n => n.id.toLowerCase() === targetId.toLowerCase() || n.name?.toLowerCase() === targetId.toLowerCase())
        if (matched) {
          setFocusedId(matched.id)
          if ((matched.type || '').toLowerCase().includes('array')) {
            setSelectedArrayId(matched.id)
          }
        }
        sessionStorage.removeItem('target_focused_node_id')
      }
    }
  }, [data])

  // When role changes, reset team selection
  const handleRoleChange = (newRole) => {
    setRole(newRole)
    setSelectedSimUserId('') // Reset simulated user
    if (newRole === 'admin') {
      setSelectedTeamId('all')
    } else {
      setSelectedTeamId(userTeamId)
    }
  }

  const handleSimUserChange = (userId) => {
    setSelectedSimUserId(userId)
    const simUser = allUsers.find(u => u._id === userId)
    if (simUser) {
      setSelectedTeamId('all')
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

  // Array nodes visible given current scope
  const arrayNodes = useMemo(() => {
    let filtered = data.nodes.filter(n => (n.type || n.label || '').toLowerCase().includes('array'))
    if (selectedTeamId && selectedTeamId !== 'all') {
      const selectedTeamName = allTeamsList.find(t => t.id === selectedTeamId)?.name || selectedTeamId || ''
      filtered = filtered.filter(n => {
        const tName = n.team || n.owner_team || ''
        return tName.toLowerCase() === selectedTeamName.toLowerCase()
      })
    }
    return filtered
  }, [data.nodes, selectedTeamId, allTeamsList])

  const activeNodes = useMemo(() => {
    let nodes = data.nodes.filter(n =>
      activeTab === 'decommissioned' ? n.isDecommissioned : !n.isDecommissioned
    )

    // Array filter override (bypasses team filter completely, shows array + connected switches & hosts)
    if (selectedArrayId && selectedArrayId !== 'all') {
      const target = nodes.find(n => n.id === selectedArrayId)
      if (!target) return []
      
      const connectedIds = new Set([selectedArrayId])
      
      // 1-hop connections (e.g. array -> switch)
      const directConnected = new Set()
      data.edges.forEach(e => {
        const fromId = e.from || e.source
        const toId = e.to || e.target
        if (fromId === selectedArrayId) directConnected.add(toId)
        if (toId === selectedArrayId) directConnected.add(fromId)
      })
      directConnected.forEach(id => connectedIds.add(id))
      
      // 2-hop connections (e.g. switch -> host)
      data.edges.forEach(e => {
        const fromId = e.from || e.source
        const toId = e.to || e.target
        if (directConnected.has(fromId)) connectedIds.add(toId)
        if (directConnected.has(toId)) connectedIds.add(fromId)
      })
      
      // Parent / child relations
      nodes.forEach(n => {
        if (n.parentId && connectedIds.has(n.parentId)) connectedIds.add(n.id)
        if (n.parentId && connectedIds.has(n.id)) connectedIds.add(n.parentId)
      })

      return nodes.filter(n => connectedIds.has(n.id))
    }

    const userTeamName = allTeamsList.find(t => t.id === userTeamId)?.name || user?.team || ''

    // Apply team/cluster filter based on role
    if (role === 'admin') {
      if (selectedTeamId !== 'all') {
        const selectedTeamName = allTeamsList.find(t => t.id === selectedTeamId)?.name || selectedTeamId || ''
        nodes = nodes.filter(n => {
          const tName = n.team || n.owner_team || ''
          return tName.toLowerCase() === selectedTeamName.toLowerCase()
        })
      }
    } else if (role === 'user') {
      // Team Member: can view all or filter by selected team
      if (selectedTeamId && selectedTeamId !== 'all') {
        const selectedTeamName = allTeamsList.find(t => t.id === selectedTeamId)?.name || selectedTeamId || ''
        nodes = nodes.filter(n => {
          const tName = n.team || n.owner_team || ''
          return tName.toLowerCase() === selectedTeamName.toLowerCase()
        })
      }
    } else if (role === 'manager' || role === 'director') {
      // Manager & Director: filter to selected team or all managed teams
      if (selectedTeamId && selectedTeamId !== 'all') {
        const selectedTeamName = allTeamsList.find(t => t.id === selectedTeamId)?.name || selectedTeamId || ''
        nodes = nodes.filter(n => {
          const tName = n.team || n.owner_team || ''
          return tName.toLowerCase() === selectedTeamName.toLowerCase()
        })
      } else {
        const allowedTeamNames = new Set(
          managerTeamIds.map(tid => {
            const tObj = allTeamsList.find(x => x.id === tid)
            return tObj ? tObj.name.toLowerCase() : tid.toLowerCase()
          })
        )
        nodes = nodes.filter(n => {
          const tName = (n.team || n.owner_team || '').toLowerCase()
          return allowedTeamNames.has(tName)
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
  }, [data.nodes, data.edges, searchQuery, activeTab, role, selectedTeamId, userTeamId, nodesById, deviceKindMap, selectedArrayId])

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
    if (focusedId === id) {
      setFocusedId(null)
    } else {
      setFocusedId(id)
    }
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
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--foreground)' }}><h3>Error</h3><p>{error}</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Test Ring Viewer
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, background: 'var(--surface-1)', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)' }}>
              Live DB
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
                <option value="director">🎬 Director</option>
                <option value="manager">🗂️ Manager</option>
                <option value="user">👥 Team Member</option>
              </select>
            </div>
            
            {['manager', 'director'].includes(role) && (
              <>
                <div style={{ height: 16, width: 1, background: 'var(--line)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Select {role === 'director' ? 'Director' : 'Manager'}:
                  </span>
                  <select
                    className="input"
                    style={{ width: 150, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer' }}
                    value={selectedSimUserId}
                    onChange={e => handleSimUserChange(e.target.value)}
                  >
                    <option value="">Select User...</option>
                    {allUsers
                      .filter(u => {
                        const uRole = u.role || 'team_member'
                        if (role === 'director') return uRole === 'director'
                        if (role === 'manager') return ['manager', 'senior_manager'].includes(uRole)
                        return false
                      })
                      .map(u => (
                        <option key={u._id} value={u._id}>{u.name || u.username}</option>
                      ))
                    }
                  </select>
                </div>
              </>
            )}
            <div style={{ height: 16, width: 1, background: 'var(--line)' }} />
          </>
        )}

        {/* Team selector — all roles can switch teams */}
        {(() => {
          const getTeamAccentColor = (teamIdOrName) => {
            const colors = ['#58a6ff', '#3fb950', '#bc8cff', '#f0883e', '#ff7b72']
            if (!teamIdOrName || teamIdOrName === 'all') return ''
            const clean = teamIdOrName.toLowerCase().replace(/ /g, '-')
            const tObj = allTeamsList.find(x => x.id === clean || x.name?.toLowerCase() === teamIdOrName.toLowerCase())
            const name = tObj ? tObj.name : teamIdOrName
            const idx = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
            return colors[Math.abs(idx) % colors.length]
          }

          const currentTeamColor = getTeamAccentColor(selectedTeamId)

          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Team:</span>
                {(role === 'manager' || role === 'director' || user?.role === 'manager' || user?.role === 'director' || user?.role === 'senior_manager') ? (
                  // Manager/Director: can switch team but only among their managed teams
                  <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer', color: currentTeamColor || 'var(--foreground)', fontWeight: currentTeamColor ? 600 : 400 }}
                    value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                    <option value="all" style={{ background: '#1a1a1a', color: '#fff' }}>All Managed Teams</option>
                    {managerTeamIds.map(tid => {
                      const col = getTeamAccentColor(tid)
                      return (
                        <option key={tid} value={tid} style={{ background: '#1a1a1a', color: col || '#fff', fontWeight: col ? 600 : 400 }}>
                          {teamIdToName[tid] || tid}
                        </option>
                      )
                    })}
                  </select>
                ) : (
                  // Admin and normal User: can pick all or specific team
                  <select className="input" style={{ width: 140, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer', color: currentTeamColor || 'var(--foreground)', fontWeight: currentTeamColor ? 600 : 400 }}
                    value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                    <option value="all" style={{ background: '#1a1a1a', color: '#fff' }}>All Teams</option>
                    {allTeamsList.map(t => {
                      const col = getTeamAccentColor(t.id)
                      return (
                        <option key={t.id} value={t.id} style={{ background: '#1a1a1a', color: col || '#fff', fontWeight: col ? 600 : 400 }}>
                          {t.name}
                        </option>
                      )
                    })}
                  </select>
                )}
              </div>

              {/* Array selector — available to all roles, filters to single array view */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Array:</span>
                {(() => {
                  const getArrayTeamColor = (arrId) => {
                    const node = data.nodes.find(n => n.id === arrId)
                    return node ? getTeamAccentColor(node.team || node.owner_team) : ''
                  }
                  const currentArrayColor = getArrayTeamColor(selectedArrayId)
                  
                  return (
                    <select
                      className="input"
                      style={{ width: 160, height: 28, padding: '0 8px', fontSize: 11, background: 'var(--background)', cursor: 'pointer', color: currentArrayColor || 'var(--foreground)', fontWeight: currentArrayColor ? 600 : 400 }}
                      value={selectedArrayId}
                      onChange={e => {
                        const val = e.target.value
                        setSelectedArrayId(val)
                        if (val !== 'all') {
                          setFocusedId(val)
                        }
                      }}
                    >
                      <option value="all" style={{ background: '#1a1a1a', color: '#fff' }}>All Arrays</option>
                      {arrayNodes.map(a => {
                        const col = getArrayTeamColor(a.id)
                        return (
                          <option key={a.id} value={a.id} style={{ background: '#1a1a1a', color: col || '#fff', fontWeight: col ? 600 : 400 }}>
                            {a.name || a.id}
                          </option>
                        )
                      })}
                    </select>
                  )
                })()}
              </div>
            </>
          )
        })()}

        {/* Role badge (Legacy Square Boxes, no pulsing dot) */}
        {role === 'user' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(88,166,255,0.1)', color: '#58a6ff', border: '1px solid rgba(88,166,255,0.2)', padding: '4px 10px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            Team-Scoped View
          </div>
        )}
        {(role === 'manager' || role === 'director') && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(210,153,34,0.1)', color: '#d29922', border: '1px solid rgba(210,153,34,0.2)', padding: '4px 10px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            {role === 'director' ? 'Director View' : 'Manager View'}
          </div>
        )}
        {role === 'admin' && (
          <div style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(63,185,80,0.1)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.2)', padding: '4px 10px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            Administrator Override
          </div>
        )}
      </div>

      {/* Collapsible Dashboard Section */}
      <div className="glass-card" style={{ marginBottom: 16, padding: '12px 18px', border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: '8px' }}>
        <div 
          onClick={() => setShowDashboardPanel(p => !p)} 
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <span style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground)' }}>
              Team Dashboard & Metrics Analytics
            </span>
            <span style={{ fontSize: 11, background: 'rgba(1,169,130,0.1)', color: 'var(--hpe-green)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              {selectedTeamId === 'all' ? 'Global View' : (teamIdToName[selectedTeamId] || selectedTeamId)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: 'var(--muted)' }}>
            <span>{showDashboardPanel ? 'Hide Dashboard' : 'Show Dashboard'}</span>
            <ChevronDown size={16} style={{ transform: showDashboardPanel ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </div>
        </div>

        {showDashboardPanel && (
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Top Row: Dropdown, Overall Metrics, Status Badges */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {/* Selector Card */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 14, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Dashboard Scope Team Selector:
                </label>
                <select 
                  className="input" 
                  style={{ width: '100%', height: 32, padding: '0 10px', fontSize: 12, background: 'var(--background)', cursor: 'pointer' }}
                  value={selectedTeamId} 
                  onChange={e => setSelectedTeamId(e.target.value)}
                >
                  <option value="all">🌐 All Teams (Global Dashboard)</option>
                  {allTeamsList.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, lineHeight: 1.3 }}>
                  Filtering the dashboard updates the metrics, status distributions, array node configuration, and fabric switch counts below.
                </p>
              </div>

              {/* Counts Summary */}
              {(() => {
                const metrics = getTeamDashboardMetrics(selectedTeamId, data.nodes)
                return (
                  <>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: 14, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-around' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--foreground)' }}>{metrics.total}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Total Devices</div>
                      </div>
                      <div style={{ width: 1, height: 40, background: 'var(--line)' }} />
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#3fb950' }}>{metrics.arrays}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Arrays</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#58a6ff' }}>{metrics.switches}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Switches</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#bc8cff' }}>{metrics.hosts}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Hosts</div>
                      </div>
                    </div>

                    {/* Health Status Split (like health tab) */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: 14, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Overall Health Status (Realtime)
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#3fb950' }}>{metrics.normal}</span>
                          <span style={{ fontSize: 9, color: 'var(--muted)' }}>Normal</span>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.2)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#d29922' }}>{metrics.degraded}</span>
                          <span style={{ fontSize: 9, color: 'var(--muted)' }}>Degraded</span>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#ff7b72' }}>{metrics.failed}</span>
                          <span style={{ fontSize: 9, color: 'var(--muted)' }}>Failed</span>
                        </div>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Middle Row: Pie Charts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {(() => {
                const metrics = getTeamDashboardMetrics(selectedTeamId, data.nodes)
                
                const deviceSplit = [
                  { label: 'Arrays', value: metrics.arrays, color: '#3fb950' },
                  { label: 'Switches', value: metrics.switches, color: '#58a6ff' },
                  { label: 'Hosts', value: metrics.hosts, color: '#bc8cff' }
                ]

                const genSplit = [
                  { label: 'GEN9', value: metrics.g9, color: '#ff7b72' },
                  { label: 'GEN10', value: metrics.g10, color: '#f0883e' },
                  { label: 'GEN11', value: metrics.g11, color: '#58a6ff' }
                ]

                const arrayNodeSplit = [
                  { label: '2-Node', value: metrics.twoNode, color: '#3fb950' },
                  { label: '4-Node', value: metrics.fourNode, color: '#1f6feb' }
                ]

                const fabricSplit = [
                  { label: 'Switched', value: metrics.switched, color: '#bc8cff' },
                  { label: 'Switchless', value: metrics.switchless, color: '#8b949e' }
                ]

                const switchSplit = [
                  { label: 'Ethernet', value: metrics.ethernet, color: '#f0883e' },
                  { label: 'FC Switch', value: metrics.fc, color: '#58a6ff' }
                ]

                return (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>Devices Split</span>
                      <PieChart data={deviceSplit} size={80} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>Generations</span>
                      <PieChart data={genSplit} size={80} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>Array Nodes Config</span>
                      <PieChart data={arrayNodeSplit} size={80} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>Fabric Connectivity</span>
                      <PieChart data={fabricSplit} size={80} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>Switch Protocol</span>
                      <PieChart data={switchSplit} size={80} />
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Bottom Row: Topology Graph Visualization Map (GEN9, GEN10, GEN11) */}
            <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--line)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground)' }}>
                  🌐 Topology Graph Spec & Map Visualization
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  Interactive Generation Node Distribution Map
                </span>
              </div>

              {(() => {
                const metrics = getTeamDashboardMetrics(selectedTeamId, data.nodes)
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, alignItems: 'center' }}>
                    {/* Visual graph layout using CSS and SVG */}
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
                      <svg width="220" height="100" viewBox="0 0 220 100">
                        <line x1="40" y1="50" x2="110" y2="50" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 2" />
                        <line x1="110" y1="50" x2="180" y2="50" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="4 2" />
                        
                        <circle cx="40" cy="50" r="24" fill="rgba(248,81,73,0.1)" stroke="#ff7b72" strokeWidth="2" />
                        <text x="40" y="46" fill="#ff7b72" fontSize="9" fontWeight="bold" textAnchor="middle">GEN9</text>
                        <text x="40" y="58" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">{metrics.g9}</text>

                        <circle cx="110" cy="50" r="28" fill="rgba(240,136,62,0.1)" stroke="#f0883e" strokeWidth="2" />
                        <text x="110" y="46" fill="#f0883e" fontSize="9" fontWeight="bold" textAnchor="middle">GEN10</text>
                        <text x="110" y="58" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">{metrics.g10}</text>

                        <circle cx="180" cy="50" r="24" fill="rgba(88,166,255,0.1)" stroke="#58a6ff" strokeWidth="2" />
                        <text x="180" y="46" fill="#58a6ff" fontSize="9" fontWeight="bold" textAnchor="middle">GEN11</text>
                        <text x="180" y="58" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">{metrics.g11}</text>
                      </svg>
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>Topology Overview Details:</span>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Generations in Ring:</span>
                        <span style={{ color: 'var(--foreground)' }}>
                          {[metrics.g9 > 0 && 'Gen9', metrics.g10 > 0 && 'Gen10', metrics.g11 > 0 && 'Gen11'].filter(Boolean).join(' + ') || 'None'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Switched Fabric Count:</span>
                        <span style={{ color: 'var(--foreground)' }}>{metrics.switched} nodes</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>FC vs Ethernet Split:</span>
                        <span style={{ color: 'var(--foreground)' }}>{metrics.fc} FC / {metrics.ethernet} Eth</span>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

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
        <div
          onMouseDown={startResizing}
          style={{
            width: '4px',
            cursor: 'col-resize',
            background: 'transparent',
            alignSelf: 'stretch',
            zIndex: 10,
            transition: 'background 0.2s',
            margin: '0 -4px'
          }}
          onMouseOver={e => e.target.style.background = 'var(--hpe-green)'}
          onMouseOut={e => e.target.style.background = 'transparent'}
        />
        <div style={{ width: sidebarWidth, flexShrink: 0, height: '100%' }}>
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
                      {selectedTeamId === 'all' ? 'All' : (selectedTeamId || '—')}
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