/**
 * StatusBar.jsx
 * Top-level stats: arrays, switches, hosts, drives, Neo4j, ES health.
 */
export default function StatusBar({ stats, apiHealth, discoveryEvents }) {
  const lastEvent = discoveryEvents[discoveryEvents.length - 1]
  const neo4jOk = apiHealth?.neo4j
  const esOk = apiHealth?.elasticsearch

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '5px 20px',
      background: 'var(--surface-2)',
      borderBottom: '1px solid var(--line)',
      fontSize: 11,
      color: 'var(--muted)',
      flexShrink: 0,
    }}>
      {[
        { label: 'Arrays',   value: stats.arrays,   color: '#58a6ff' },
        { label: 'Switches', value: stats.switches, color: '#bc8cff' },
        { label: 'Hosts',    value: stats.hosts,    color: '#3fb950' },
        { label: 'Drives',   value: stats.drives,   color: '#39c5cf' },
      ].map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 700, color: s.color, fontSize: 13 }}>{s.value}</span>
          <span>{s.label}</span>
        </div>
      ))}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: neo4jOk ? '#3fb950' : '#f85149', display: 'inline-block' }} />
          Neo4j
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: esOk ? '#3fb950' : '#f85149', display: 'inline-block' }} />
          Elasticsearch
        </span>
        {lastEvent && (
          <span style={{ color: 'var(--muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>
            {lastEvent.msg}
          </span>
        )}
      </div>
    </div>
  )
}
