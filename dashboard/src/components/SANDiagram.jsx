import { useMemo, useState, useRef, useEffect } from "react";

export default function SANDiagram({ data, focusedId, expandedIds = [], onNodeClick, selectedIds, onSelectToggle, searchQuery }) {
  const { nodes = [], edges = [] } = data || {};

  const [colWidths, setColWidths] = useState([350, 380, 350]);
  const [showArrays, setShowArrays] = useState(true);
  const [showSwitches, setShowSwitches] = useState(true);
  const [showEthSwitches, setShowEthSwitches] = useState(true);
  const [showHosts, setShowHosts] = useState(true);
  const dragState = useRef({ isDragging: -1, startX: 0, startWidth: 0 });

  useEffect(() => {
    const handleMove = (e) => {
      if (dragState.current.isDragging === -1) return;
      const { isDragging, startX, startWidth } = dragState.current;
      const delta = e.clientX - startX;
      setColWidths(prev => {
        const next = [...prev];
        next[isDragging] = Math.max(200, startWidth + delta);
        return next;
      });
    };
    const handleUp = () => {
      if (dragState.current.isDragging !== -1) {
        document.body.style.cursor = "";
      }
      dragState.current.isDragging = -1;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const handlePointerDown = (index, e) => {
    e.preventDefault();
    dragState.current = {
      isDragging: index,
      startX: e.clientX,
      startWidth: colWidths[index]
    };
    document.body.style.cursor = "col-resize";
  };

  // Filter out decommissioned from standard view
  const activeNodes = useMemo(() => nodes.filter(n => !n.isDecommissioned), [nodes]);

  const arrays = activeNodes.filter(n => n.category === "main" && (n.type === "Array" || n.type === "ArraySystem"));
  const switches = activeNodes.filter(n => 
    n.category === "main" && 
    (
      n.type === "Switch" || 
      n.type.toLowerCase().includes("switch") ||
      (n.switchType && n.switchType.toLowerCase().includes("switch"))
    )
  );
  const hosts = activeNodes.filter(n => n.category === "main" && n.type === "Host");

  // Determine which arrays are selected or focused
  const selectedArrayIds = useMemo(() => {
    const selected = arrays.filter(a => selectedIds?.has(a.id)).map(a => a.id);
    if (selected.length > 0) {
      return selected;
    }
    if (focusedId && arrays.some(a => a.id === focusedId)) {
      return [focusedId];
    }
    return [];
  }, [arrays, selectedIds, focusedId]);

  // Find all nodes connected to the selected arrays
  const connectedNodeIds = useMemo(() => {
    if (selectedArrayIds.length === 0) return null;
    const visited = new Set(selectedArrayIds);
    const queue = [...selectedArrayIds];
    const adj = {};
    activeNodes.forEach(n => {
      adj[n.id] = [];
    });
    edges.forEach(e => {
      if (adj[e.from] && adj[e.to]) {
        adj[e.from].push(e.to);
        adj[e.to].push(e.from);
      }
    });
    activeNodes.forEach(n => {
      if (n.parentId) {
        if (adj[n.id] && adj[n.parentId]) {
          adj[n.id].push(n.parentId);
          adj[n.parentId].push(n.id);
        }
      }
    });
    while (queue.length > 0) {
      const curr = queue.shift();
      const neighbors = adj[curr] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return visited;
  }, [selectedArrayIds, activeNodes, edges]);

  const visibleSwitches = useMemo(() => {
    if (!connectedNodeIds) return switches;
    return switches.filter(s => connectedNodeIds.has(s.id));
  }, [switches, connectedNodeIds]);

  const visibleHosts = useMemo(() => {
    if (!connectedNodeIds) return hosts;
    return hosts.filter(h => connectedNodeIds.has(h.id));
  }, [hosts, connectedNodeIds]);

  // Helper to get sub-components for a parent
  const getSubNodes = (parentId) => activeNodes.filter(n => n.parentId === parentId);
  const getConnectedEdges = (nodeId) => edges.filter(e => e.from === nodeId || e.to === nodeId);
  
  // Is this node part of the focused component path?
  const isHighlighted = (id) => {
    if (!focusedId) return false;
    if (focusedId === id) return true;
    const paths = getConnectedEdges(focusedId);
    return paths.some(p => p.from === id || p.to === id);
  };

  const renderCard = (node, isSub = false) => {
    const isExpanded = expandedIds.includes(node.id);
    const focused = focusedId === node.id;
    const highlight = isHighlighted(node.id);
    const subs = getSubNodes(node.id);
    
    // Group sub-components by type for cleaner display inside parent
    const subsByType = subs.reduce((acc, sub) => {
      if (!acc[sub.type]) acc[sub.type] = [];
      acc[sub.type].push(sub);
      return acc;
    }, {});

    const isSearchMatch = searchQuery && (
      node.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
      node.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.type?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getTeamAccentColor = (teamName) => {
      const colors = ['#58a6ff', '#3fb950', '#bc8cff', '#f0883e', '#ff7b72'];
      if (!teamName) return null;
      const idx = teamName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return colors[Math.abs(idx) % colors.length];
    }
    const teamAccent = getTeamAccentColor(node.team || node.owner_team);

    return (
      <div key={node.id} style={{ position: 'relative', width: '100%', marginBottom: 24 }}>
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onNodeClick(node.id, false);
          }}
          className={`san-node ${focused ? "focused" : highlight ? "expanded" : ""} ${isSearchMatch ? "search-match-pulse" : ""}`}
          style={{
            position: 'relative', zIndex: 10, width: '100%', cursor: 'pointer',
            border: '1px solid var(--line)',
            borderLeft: teamAccent ? `5px solid ${teamAccent}` : '1px solid var(--line)',
            padding: isSub ? 12 : 16,
            borderRadius: isSub ? 6 : 12, transition: 'all 0.3s ease',
            background: isSub ? 'var(--surface-1)' : 'var(--surface-2)',
            boxShadow: focused ? `0 0 0 2px ${teamAccent || 'var(--accent-blue)'}` : highlight ? `0 0 0 1px ${teamAccent || 'var(--accent-blue)'}` : 'none'
          }}
        >
          <div 
            style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => onNodeClick(node.id)}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              {selectedIds && onSelectToggle && (
                <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    style={{ accentColor: 'var(--accent-blue)', width: 14, height: 14, cursor: 'pointer' }}
                    checked={selectedIds.has(node.id)}
                    onChange={(e) => onSelectToggle(node.id, e.target.checked)}
                  />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: node.status === 'normal' ? 'var(--status-ok)' : node.status === 'degraded' ? 'var(--status-warn)' : 'var(--status-critical)' }} />
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted)' }}>{node.type}</span>
                </div>
                <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--foreground)', fontSize: isSub ? 14 : 16 }} title={node.name}>{node.name}</h3>
                <p style={{ marginTop: 2, fontSize: 12, color: 'var(--muted)' }}>{node.id}</p>
              </div>
            </div>
            
            {subs.length > 0 && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeClick(node.id, true);
                }}
                style={{
                  marginTop: 4, display: 'flex', height: 24, width: 24, alignItems: 'center', justifyContent: 'center',
                  borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface-1)', color: 'var(--muted)',
                  transition: 'all 0.2s', cursor: 'pointer'
                }}
              >
                <svg style={{ height: 16, width: 16, transition: 'transform 0.3s', transform: isExpanded ? 'rotate(180deg)' : 'none', color: isExpanded ? 'var(--accent-blue)' : 'inherit' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Main card extra details */}
          {!isSub && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10, color: 'var(--muted)' }}>
              {node.protocol && <span style={{ borderRadius: 4, border: '1px solid var(--line)', background: 'var(--surface-1)', padding: '2px 8px' }}>{node.protocol}</span>}
              {node.model && <span style={{ borderRadius: 4, border: '1px solid var(--line)', background: 'var(--surface-1)', padding: '2px 8px' }}>{node.model}</span>}
            </div>
          )}
        </div>

        {/* Sub-components container */}
        {isExpanded && subs.length > 0 && (
          <div style={{ position: 'relative', marginLeft: 16, marginTop: 4, borderLeft: '2px solid var(--line)', padding: '16px 12px 8px 12px' }}>
            {Object.entries(subsByType).map(([type, nodesOfType]) => (
              <div key={type} style={{ position: 'relative' }}>
                <div style={{ marginBottom: 8, paddingLeft: 8, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--muted)' }}>
                  <span style={{ position: 'absolute', left: -18, top: 6, height: 2, width: 12, background: 'var(--line)' }}></span>
                  {type}s ({nodesOfType.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, paddingLeft: 8 }}>
                  {nodesOfType.map(subNode => renderCard(subNode, true))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'auto', padding: '16px 8px' }}>

      <div 
        style={{
          display: 'flex', height: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 32, padding: '0 16px', minWidth: 900
        }}
      >
        
        {/* Column 1: Arrays */}
        <div style={{ display: 'flex', width: colWidths[0], flexDirection: 'column', alignItems: 'center', padding: '0 8px', flexShrink: 0 }}>
          <div 
            onClick={() => setShowArrays(!showArrays)}
            style={{ marginBottom: 8, display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--line)', paddingBottom: 8, fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', cursor: 'pointer' }}
          >
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <svg style={{ width: 16, height: 16 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" /></svg>
               Storage Arrays
             </div>
             <svg style={{ width: 16, height: 16, transition: 'transform 0.3s', transform: showArrays ? 'rotate(180deg)' : 'none' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
          {showArrays && arrays.map(node => renderCard(node))}
        </div>

        {/* Visual Line Connectors Helper - Now a drag handle */}
        <div 
          onPointerDown={(e) => handlePointerDown(0, e)}
          style={{ marginTop: 80, display: 'flex', height: '100%', width: 40, cursor: 'col-resize', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, transition: 'all 0.2s', margin: '0 8px' }}
          title="Drag to resize Storage Arrays column"
        >
          <div style={{ height: '60%', width: 1, background: 'linear-gradient(to bottom, transparent, var(--accent-blue), transparent)', pointerEvents: 'none' }}></div>
          <svg style={{ margin: '8px 0', height: 24, width: 24, transform: 'rotate(90deg)', color: 'var(--accent-blue)', pointerEvents: 'none' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
          <div style={{ height: '60%', width: 1, background: 'linear-gradient(to bottom, transparent, var(--accent-blue), transparent)', pointerEvents: 'none' }}></div>
        </div>

        {/* Column 2: Switches (FC / Ethernet / SAS / InfiniBand / FCoE) */}
        <div style={{ display: 'flex', width: colWidths[1], flexDirection: 'column', alignItems: 'center', padding: '0 8px', flexShrink: 0 }}>
          <div
            onClick={() => setShowSwitches(!showSwitches)}
            style={{ marginBottom: 8, display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--line)', paddingBottom: 8, fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg style={{ width: 16, height: 16 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
              FC / Ethernet / SAS / InfiniBand / FCoE Switches
              <span style={{ fontSize: 10, background: 'rgba(88,166,255,0.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,0.25)', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>{visibleSwitches.length}</span>
            </div>
            <svg style={{ width: 16, height: 16, transition: 'transform 0.3s', transform: showSwitches ? 'rotate(180deg)' : 'none' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
          {showSwitches && visibleSwitches.length > 0 && visibleSwitches.map(node => renderCard(node))}
          {showSwitches && visibleSwitches.length === 0 && (
            <div style={{ width: '100%', padding: '12px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted)', border: '1px dashed var(--line)', borderRadius: 8 }}>
              No switches detected
            </div>
          )}
        </div>

        {/* Visual Line Connectors Helper - Now a drag handle */}
        <div 
          onPointerDown={(e) => handlePointerDown(1, e)}
          style={{ marginTop: 80, display: 'flex', height: '100%', width: 40, cursor: 'col-resize', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, transition: 'all 0.2s', margin: '0 8px' }}
          title="Drag to resize Fabric Switches column"
        >
          <div style={{ height: '60%', width: 1, background: 'linear-gradient(to bottom, transparent, var(--accent-blue), transparent)', pointerEvents: 'none' }}></div>
          <svg style={{ margin: '8px 0', height: 24, width: 24, transform: 'rotate(90deg)', color: 'var(--accent-blue)', pointerEvents: 'none' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
          <div style={{ height: '60%', width: 1, background: 'linear-gradient(to bottom, transparent, var(--accent-blue), transparent)', pointerEvents: 'none' }}></div>
        </div>

        {/* Column 3: Hosts */}
        <div style={{ display: 'flex', width: colWidths[2], flexDirection: 'column', alignItems: 'center', padding: '0 8px', flexShrink: 0 }}>
          <div 
            onClick={() => setShowHosts(!showHosts)}
            style={{ marginBottom: 8, display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--line)', paddingBottom: 8, fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted)', cursor: 'pointer' }}
          >
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <svg style={{ width: 16, height: 16 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" /></svg>
               Compute Hosts
               <span style={{ fontSize: 10, background: 'rgba(88,166,255,0.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,0.25)', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>{visibleHosts.length}</span>
             </div>
             <svg style={{ width: 16, height: 16, transition: 'transform 0.3s', transform: showHosts ? 'rotate(180deg)' : 'none' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
          {showHosts && visibleHosts.map(node => renderCard(node))}
          {showHosts && visibleHosts.length === 0 && (
            <div style={{ width: '100%', padding: '12px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted)', border: '1px dashed var(--line)', borderRadius: 8 }}>
              No hosts detected
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
