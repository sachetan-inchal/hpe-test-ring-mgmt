/**
 * AggregateSidebar.jsx
 * Right sidebar — adapted from hpe-ontology-and-graph/NodeCard.tsx
 * Shows deep aggregated details for a selected node:
 *   - Identity, status, IP, model
 *   - All properties (firmware, capacity, ports, etc.)
 *   - Connected devices
 *   - "Open Terminal" button → Cisco Packet Tracer-style
 */
import { useMemo } from 'react'

const TYPE_ICONS = {
  Array: '🗄', ArraySystem: '🗄',
  Switch: '🔀', Host: '🖥',
  Cage: '📦', PhysicalDisk: '💿',
  Port: '🔌', Node: '⚙',
}

const TYPE_COLORS = {
  Array: '#58a6ff', ArraySystem: '#58a6ff',
  Switch: '#bc8cff', Host: '#3fb950',
  Cage: '#e3a042', PhysicalDisk: '#39c5cf',
  Port: '#d29922', Node: '#8b949e',
}

function getStatusColor(status) {
  if (!status || status === 'normal' || status === 'ok') return '#3fb950'
  if (status === 'degraded' || status === 'warn') return '#d29922'
  return '#f85149'
}

function PropRow({ label, value }) {
  if (value === undefined || value === null || value === '') return null
  const display = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      padding: '7px 10px',
      background: 'var(--surface-2)',
      borderRadius: 7,
      border: '1px solid var(--line)',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--foreground)', fontFamily: display.length > 20 ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>
        {display}
      </span>
    </div>
  )
}

const EXCLUDE_KEYS = ['id', 'name', 'type', 'status', 'label', 'entity_counts']

export default function AggregateSidebar({ node, allNodes, allEdges, onOpenTerminal, onClose, apiBase }) {
  const connections = useMemo(() => {
    if (!node || !allEdges) return []
    const nodeId = node.id
    const connectedIds = new Set()
    allEdges.forEach(e => {
      if (e.from === nodeId) connectedIds.add(e.to)
      if (e.to === nodeId) connectedIds.add(e.from)
    })
    return allNodes.filter(n => connectedIds.has(n.id) && n.id !== nodeId)
  }, [node, allNodes, allEdges])

  if (!node) {
    return (
      <aside style={{
        width: 320, flexShrink: 0,
        background: 'var(--surface-1)',
        borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', padding: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>📋</div>
        <p style={{ fontSize: 13, fontWeight: 600 }}>Select a node</p>
        <p style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>Click any device in the topology to inspect its details</p>
      </aside>
    )
  }

  const icon = TYPE_ICONS[node.type] || '📡'
  const color = TYPE_COLORS[node.type] || '#8b949e'
  const statusColor = getStatusColor(node.status)

  const props = Object.entries(node)
    .filter(([k]) => !EXCLUDE_KEYS.includes(k))
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !Array.isArray(v))

  const hasTerminal = ['Array', 'ArraySystem', 'Switch', 'Host'].includes(node.type) && node.ip

  return (
    <aside
      className="slide-in-right"
      style={{
        width: 340, flexShrink: 0,
        background: 'var(--surface-1)',
        borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface-2)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color }}>{node.type}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 7px', borderRadius: 20, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: `rgba(${statusColor.replace('#', '').match(/../g).map(h => parseInt(h, 16)).join(',')}, 0.15)`,
              color: statusColor,
              border: `1px solid ${statusColor}44`,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
              {node.status || 'normal'}
            </span>
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.2 }}>{node.name || node.id}</h2>
          {node.ip && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{node.ip}</span>}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 4, fontSize: 16 }}
          title="Close sidebar"
        >✕</button>
      </div>

      {/* Open Terminal button */}
      {hasTerminal && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => onOpenTerminal(node)}
          >
            <span>⌨</span> Open Terminal
          </button>
        </div>
      )}

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {/* Properties */}
        {props.length > 0 && (
          <>
            <div className="section-label" style={{ marginBottom: 8 }}>Properties</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
              {props.map(([k, v]) => <PropRow key={k} label={k} value={v} />)}
            </div>
          </>
        )}

        {/* Entity counts (from discovery) */}
        {node.entity_counts && (
          <>
            <div className="divider" style={{ marginBottom: 12 }} />
            <div className="section-label" style={{ marginBottom: 8 }}>Discovered Entities</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 16 }}>
              {Object.entries(node.entity_counts).map(([k, v]) => (
                <div key={k} style={{
                  textAlign: 'center', padding: '8px 4px',
                  background: 'var(--surface-2)', borderRadius: 8,
                  border: '1px solid var(--line)',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-blue)' }}>{v}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Connections */}
        {connections.length > 0 && (
          <>
            <div className="divider" style={{ marginBottom: 12 }} />
            <div className="section-label" style={{ marginBottom: 8 }}>Connected Devices ({connections.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {connections.slice(0, 12).map(conn => {
                const connIcon = TYPE_ICONS[conn.type] || '📡'
                const connColor = TYPE_COLORS[conn.type] || '#8b949e'
                const connStatusColor = getStatusColor(conn.status)
                return (
                  <div key={conn.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px',
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span>{connIcon}</span>
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--foreground)', fontWeight: 500 }}>{conn.name || conn.id}</div>
                        {conn.ip && <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{conn.ip}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: connStatusColor }} />
                      <span style={{ fontSize: 9, color: connColor, fontWeight: 700, textTransform: 'uppercase' }}>{conn.type}</span>
                    </div>
                  </div>
                )
              })}
              {connections.length > 12 && (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 4 }}>
                  +{connections.length - 12} more
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
