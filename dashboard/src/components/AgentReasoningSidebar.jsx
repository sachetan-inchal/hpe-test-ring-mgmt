import { Database, Circle } from 'lucide-react'
import TopologyCanvas from './TopologyCanvas'

function ResultTable({ rows }) {
  if (!rows?.length) {
    return <p style={{ fontSize: 12, color: 'var(--muted)', padding: 12 }}>No tabular results yet.</p>
  }
  const keys = Object.keys(rows[0])
  return (
    <div style={{ overflowX: 'auto', padding: '0 12px 12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {keys.map(k => (
              <th key={k} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}>
                {k.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row, i) => (
            <tr key={i}>
              {keys.map(k => (
                <td key={k} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                  {String(row[k] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>+{rows.length - 20} more rows</p>
      )}
    </div>
  )
}

export default function AgentReasoningSidebar({ agentResult, showSteps, onToggleSteps, width = 320 }) {
  const connected = agentResult?.neo4j_connected
  const rows = agentResult?.table || []
  const graph = agentResult?.graph

  const cyNodes = (graph?.nodes || []).map(n => ({
    id: n.data?.id,
    label: n.data?.label,
    type: n.data?.type,
    status: 'normal',
  }))
  const cyEdges = (graph?.edges || []).map(e => ({
    from: e.data?.source,
    to: e.data?.target,
    label: e.data?.label,
  }))

  return (
    <aside className="agent-sidebar animate-fade-in" style={{ width }}>
      <div className="agent-sidebar-section">
        <div className="agent-kb-status">
          <Database size={16} style={{ color: 'var(--hpe-green)' }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>Knowledge Base</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Circle size={8} fill={connected ? 'var(--hpe-green)' : 'var(--status-critical)'} color="transparent" />
              Neo4j {connected ? 'Connected' : 'Unavailable'}
            </div>
          </div>
        </div>
      </div>

      <div className="agent-sidebar-section">
        <div className="agent-sidebar-heading">Results</div>
        <ResultTable rows={rows} />
        {rows.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--hpe-green)', padding: '0 12px 8px', fontWeight: 600 }}>
            Total: {rows.length}
          </p>
        )}
      </div>

      {cyNodes.length > 0 && (
        <div className="agent-sidebar-section agent-sidebar-graph">
          <div className="agent-sidebar-heading">Topology slice</div>
          <div style={{ height: 220, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <TopologyCanvas data={{ nodes: cyNodes, edges: cyEdges }} isSidebar={true} />
          </div>
        </div>
      )}

      {agentResult?.cypher && (
        <div className="agent-sidebar-section">
          <div className="agent-sidebar-heading">Cypher</div>
          <pre className="agent-step-cmd agent-step-cypher" style={{ margin: '0 12px 12px' }}>{agentResult.cypher}</pre>
        </div>
      )}

      {showSteps != null && (
        <button type="button" className="btn btn-sm" style={{ margin: '8px 12px', width: 'calc(100% - 24px)' }} onClick={onToggleSteps}>
          {showSteps ? 'Hide' : 'Show'} execution trace in chat
        </button>
      )}
    </aside>
  )
}
