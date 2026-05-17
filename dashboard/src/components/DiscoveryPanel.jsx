/**
 * DiscoveryPanel.jsx
 * Live discovery log panel with SSE event streaming.
 * Shows flooding animation progress, device-by-device discovery,
 * command execution, parsed entity counts, and Neo4j/ES indexing status.
 */
import { useRef, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'

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
  const [expanded, setExpanded] = useState(false)
  const color = EV_COLORS[event.type] || '#8b949e'
  const icon = EV_ICONS[event.type] || '•'
  const isCommand = event.type === 'command'
  const hasOutput = isCommand && (event.output || event.output_preview)
  const displayOutput = event.output || event.output_preview

  return (
    <div 
      onClick={hasOutput ? () => setExpanded(!expanded) : undefined}
      className={hasOutput ? "cli-command-row" : ""}
      style={{
        display: 'flex', flexDirection: 'column',
        padding: '6px 8px',
        margin: '2px 0',
        borderRadius: 4,
        borderLeft: event.type === 'connected' || event.type === 'complete' ? `2px solid ${color}` : '2px solid transparent',
        transition: 'all 0.2s ease',
        cursor: hasOutput ? 'pointer' : 'default',
        background: expanded ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ 
            fontSize: 11, color, lineHeight: 1.6, wordBreak: 'break-all',
            opacity: isCommand ? 0.75 : 1,
            fontWeight: isCommand ? '600' : 'normal'
          }}>
            {event.msg || JSON.stringify(event)}
          </span>
          {hasOutput && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              style={{
                background: 'transparent', border: 'none', color: 'var(--muted)',
                padding: 0, display: 'flex', cursor: 'pointer',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                marginLeft: 'auto'
              }}
            >
              <ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>
      
      {expanded && hasOutput && (
        <div className="rise-in" style={{
          marginTop: 6, marginBottom: 4,
          padding: '8px 10px', background: 'rgba(0, 0, 0, 0.25)',
          borderRadius: 6, border: '1px solid var(--line)',
          fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap', maxHeight: 250, overflowY: 'auto',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.4)',
          lineHeight: 1.4
        }}>
          {displayOutput}
        </div>
      )}

      {event.entity_counts && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5, paddingLeft: 22 }}>
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
  )
}

export default function DiscoveryPanel({ events, running, onClose, onStartDiscovery, apiBase }) {
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
          {running ? (
            <button
              className="btn btn-danger btn-sm animate-pulse"
              onClick={async () => {
                try {
                  await fetch(`${apiBase}/api/discover/cancel`, { method: 'POST' })
                } catch (e) {
                  console.error("Failed to cancel discovery:", e)
                }
              }}
            >🛑 Cancel</button>
          ) : (
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
        <input type="range" id="delay-slider" min="0" max="150" step="5" defaultValue="0" style={{ width: 60 }} title="Animation Delay" />
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
