/**
 * DiscoveryPanel.jsx
 * Live discovery log panel with SSE event streaming.
 * Shows flooding animation progress, device-by-device discovery,
 * command execution, parsed entity counts, and Neo4j/ES indexing status.
 */
import { useRef, useEffect } from 'react'

const EV_COLORS = {
  start:          '#58a6ff',
  connecting:     '#58a6ff',
  connected:      '#3fb950',
  command:        '#8b949e',
  parsed:         '#39c5cf',
  neo4j_stored:   '#bc8cff',
  es_indexed:     '#d29922',
  discovered_ip:  '#bc8cff',
  unreachable:    '#f85149',
  error:          '#f85149',
  complete:       '#3fb950',
  skip:           '#8b949e',
}

const EV_ICONS = {
  start:         '🚀',
  connecting:    '🔗',
  connected:     '✅',
  command:       '⌨',
  parsed:        '📊',
  neo4j_stored:  '🔷',
  es_indexed:    '🔍',
  discovered_ip: '🌐',
  unreachable:   '❌',
  error:         '🔴',
  complete:      '🏁',
  skip:          '⏭',
}

function EventRow({ event, index }) {
  const color = EV_COLORS[event.type] || '#8b949e'
  const icon = EV_ICONS[event.type] || '•'
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: '3px 0',
      opacity: event.type === 'command' ? 0.65 : 1,
      borderLeft: event.type === 'connected' || event.type === 'complete' ? `2px solid ${color}` : '2px solid transparent',
      paddingLeft: 8,
    }}>
      <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, color, lineHeight: 1.6, wordBreak: 'break-all' }}>
          {event.msg || JSON.stringify(event)}
        </span>
        {event.entity_counts && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
            {Object.entries(event.entity_counts).filter(([, v]) => v > 0).map(([k, v]) => (
              <span key={k} style={{
                padding: '0 6px', borderRadius: 20, fontSize: 9, fontWeight: 700,
                background: 'rgba(57, 197, 207, 0.12)', color: '#39c5cf',
                border: '1px solid rgba(57, 197, 207, 0.3)',
              }}>{k}: {v}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DiscoveryPanel({ events, running, onClose, onStartDiscovery }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [events.length])

  const stats = {
    devices:  events.filter(e => e.type === 'connected').length,
    commands: events.filter(e => e.type === 'command').length,
    parsed:   events.filter(e => e.type === 'parsed').length,
    errors:   events.filter(e => e.type === 'error' || e.type === 'unreachable').length,
  }

  return (
    <div
      className="slide-in-right"
      style={{
        width: 400, flexShrink: 0,
        background: 'var(--surface-1)',
        borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {running && <span className="pulse-dot blue" />}
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
            {running ? 'Discovery Running' : 'Discovery Log'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!running && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onStartDiscovery(['10.20.10.5'])}
            >▶ Re-run</button>
          )}
          <button onClick={onClose} className="btn btn-sm">✕</button>
        </div>
      </div>

      {/* Stats strip */}
      {events.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1, background: 'var(--line)',
          borderBottom: '1px solid var(--line)',
        }}>
          {[
            { label: 'Devices', value: stats.devices, color: '#3fb950' },
            { label: 'Commands', value: stats.commands, color: '#8b949e' },
            { label: 'Parsed', value: stats.parsed, color: '#39c5cf' },
            { label: 'Errors', value: stats.errors, color: stats.errors > 0 ? '#f85149' : '#8b949e' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface-1)', padding: '8px 4px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Log body */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '10px 14px',
        fontFamily: 'var(--font-mono)',
      }}>
        {events.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', paddingTop: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
            <p style={{ fontSize: 12 }}>No discovery events yet</p>
            <p style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Click "Start Discovery" to begin</p>
          </div>
        ) : (
          events.map((ev, i) => <EventRow key={i} event={ev} index={i} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer controls */}
      <div style={{
        padding: '8px 14px',
        borderTop: '1px solid var(--line)',
        background: 'var(--surface-2)',
        display: 'flex', gap: 6, alignItems: 'center'
      }}>
        <input
          placeholder="Seed IP (e.g. 10.20.10.5)"
          className="input"
          style={{ fontSize: 11, width: 120 }}
          id="seed-ip-input"
          defaultValue="10.20.10.5"
        />
        <label style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>Delay:</label>
        <input type="range" id="delay-slider" min="0" max="500" defaultValue="20" style={{ width: 60 }} title="Animation Delay" />
        <button
          className="btn btn-success btn-sm"
          disabled={running}
          onClick={() => {
            const ip = document.getElementById('seed-ip-input').value.trim()
            const delay = document.getElementById('delay-slider').value
            if (ip) onStartDiscovery([ip], parseInt(delay))
          }}
        >
          ▶
        </button>
      </div>
    </div>
  )
}
