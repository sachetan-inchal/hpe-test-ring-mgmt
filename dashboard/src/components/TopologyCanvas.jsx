/**
 * TopologyCanvas.jsx
 * Visual SAN Topology Map — adapted from hpe-ontology-and-graph/VisualMap.tsx
 * Uses @xyflow/react for interactive, zoomable, pannable graph.
 * Discovery animation: nodes pulse blue as they are found.
 */
import { useCallback, useMemo, useRef } from 'react'
import { toPng } from 'html-to-image'
import {
  ReactFlow, Controls, Background, MiniMap,
  useNodesState, useEdgesState,
  MarkerType, Panel
} from '@xyflow/react'

// ── Device type → color + icon ──────────────────────────────────────────────
const TYPE_META = {
  Array:       { color: '#58a6ff', icon: '🗄', yTier: 400 },
  ArraySystem: { color: '#58a6ff', icon: '🗄', yTier: 400 },
  Switch:      { color: '#bc8cff', icon: '🔀', yTier: 250 },
  Host:        { color: '#3fb950', icon: '🖥', yTier: 100 },
  Cage:        { color: '#e3a042', icon: '📦', yTier: 550 },
  PhysicalDisk:{ color: '#39c5cf', icon: '💿', yTier: 700 },
  Port:        { color: '#d29922', icon: '🔌', yTier: 300 },
  Node:        { color: '#8b949e', icon: '⚙',  yTier: 300 },
  Device:      { color: '#8b949e', icon: '📡', yTier: 300 },
}

function getTypeMeta(type) {
  return TYPE_META[type] || { color: '#8b949e', icon: '?', yTier: 300 }
}

function buildCustomNode(n, highlighted, selected, pulsingIds) {
  const meta = getTypeMeta(n.type)
  const isHighlighted = highlighted?.has(n.ip || n.id)
  const isPulsing = pulsingIds?.has(n.id)
  const isSelected = selected === n.id
  return {
    id: n.id,
    position: { x: 0, y: 0 }, // layout applied below
    data: {
      label: (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
          textAlign: 'left',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 14 }}>{meta.icon}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: meta.color,
            }}>{n.type}</span>
          </div>
          <strong style={{ fontSize: 11, color: '#e6edf3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{n.name || n.id}</strong>
          {n.ip && <span style={{ fontSize: 9, color: '#8b949e', fontFamily: 'JetBrains Mono, monospace' }}>{n.ip}</span>}
          {n.model && <span style={{ fontSize: 9, color: '#8b949e' }}>{n.model}</span>}
        </div>
      )
    },
    className: isPulsing ? 'rf-node-pulse' : undefined,
    style: {
      background: isSelected ? `rgba(${hexToRgb(meta.color)}, 0.2)` : '#161b22',
      border: `1.5px solid ${isSelected ? meta.color : isHighlighted || isPulsing ? meta.color : '#30363d'}`,
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      color: '#e6edf3',
      minWidth: 160,
      boxShadow: isPulsing
        ? `0 0 0 4px rgba(${hexToRgb(meta.color)}, 0.55), 0 0 24px rgba(${hexToRgb(meta.color)}, 0.35)`
        : isHighlighted
          ? `0 0 0 3px rgba(${hexToRgb(meta.color)}, 0.4), 0 0 20px rgba(${hexToRgb(meta.color)}, 0.2)`
          : isSelected ? `0 0 0 2px ${meta.color}` : '0 2px 8px rgba(0,0,0,0.4)',
      transition: 'all 0.3s ease',
    }
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

// ── Auto-layout: tier-based y, spread x ──────────────────────────────────────
function autoLayout(nodes) {
  const tiers = {}
  nodes.forEach(n => {
    const t = getTypeMeta(n.type).yTier
    if (!tiers[t]) tiers[t] = []
    tiers[t].push(n)
  })
  const laid = []
  Object.entries(tiers).forEach(([tier, tierNodes]) => {
    const y = parseInt(tier)
    const spacingX = 200
    const totalW = (tierNodes.length - 1) * spacingX
    const startX = -(totalW / 2)
    tierNodes.forEach((n, i) => {
      laid.push({ ...n, position: { x: startX + i * spacingX, y } })
    })
  })
  return laid
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TopologyCanvas({ nodes, edges, selectedNode, onNodeClick, highlightedIps, discoveryRunning, pulsingIds }) {
  const selectedId = selectedNode?.id
  const exportRef = useRef(null)

  const rfNodes = useMemo(() => {
    const withLayout = autoLayout(nodes)
    return withLayout.map(n => buildCustomNode(n, highlightedIps, selectedId, pulsingIds))
  }, [nodes, highlightedIps, selectedId, pulsingIds])

  const exportPng = useCallback(async () => {
    const el = exportRef.current
    if (!el || nodes.length === 0) return
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: '#0d1117' })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = 'san-topology.png'
      a.click()
    } catch (e) {
      console.error('PNG export failed', e)
    }
  }, [nodes.length])

  const rfEdges = useMemo(() => edges.map(e => ({
    id: e.id || `${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label,
    animated: discoveryRunning,
    style: {
      stroke: e.label === 'REMOTE_COPY' ? '#bc8cff'
            : e.label === 'discovered'  ? '#58a6ff'
            : '#30363d',
      strokeWidth: 1.5,
      opacity: 0.75,
    },
    labelStyle: { fill: '#8b949e', fontSize: 9, fontWeight: 600 },
    labelBgStyle: { fill: '#0d1117' },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#30363d',
      width: 14, height: 14,
    },
  })), [edges, discoveryRunning])

  const [rfNodesState, , onNodesChange] = useNodesState(rfNodes)
  const [rfEdgesState, , onEdgesChange] = useEdgesState(rfEdges)

  // Sync external state changes to react flow
  const stableNodes = rfNodes
  const stableEdges = rfEdges

  const handleNodeClick = useCallback((_, rfNode) => {
    const found = nodes.find(n => n.id === rfNode.id)
    if (found) onNodeClick(found)
  }, [nodes, onNodeClick])

  const miniMapColor = useCallback((n) => {
    const meta = getTypeMeta(n.data?.label || 'Device')
    return meta.color
  }, [])

  return (
    <div ref={exportRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', zIndex: 5, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🌐</div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No topology data yet</p>
          <p style={{ fontSize: 13, opacity: 0.7 }}>Click "Start Discovery" to scan the SAN network</p>
        </div>
      )}
      <ReactFlow
        nodes={stableNodes}
        edges={stableEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.05}
        maxZoom={3}
        colorMode="dark"
        attributionPosition="bottom-left"
      >
        <Background color="#21262d" gap={28} size={1} />
        <Controls className="rf-controls" />
        <MiniMap
          nodeColor={miniMapColor}
          maskColor="rgba(13, 17, 23, 0.7)"
          style={{ background: '#161b22', border: '1px solid #30363d' }}
        />
        <Panel position="top-left">
          {discoveryRunning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px',
              background: 'rgba(88, 166, 255, 0.1)',
              border: '1px solid rgba(88, 166, 255, 0.3)',
              borderRadius: 8,
              fontSize: 12, color: 'var(--accent-blue)',
            }}>
              <span className="pulse-dot blue" />
              BFS Discovery in progress...
            </div>
          )}
        </Panel>
        <Panel position="bottom-right">
          <button type="button" className="btn btn-sm" onClick={exportPng} disabled={nodes.length === 0}>
            Export PNG
          </button>
        </Panel>
      </ReactFlow>
    </div>
  )
}
