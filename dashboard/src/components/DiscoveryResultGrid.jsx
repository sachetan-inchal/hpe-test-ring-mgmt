import { Database, Monitor, Share2, Cpu, HardDrive } from 'lucide-react'

const TYPE_ICONS = {
  Array: <Database size={20} />,
  ArraySystem: <Database size={20} />,
  Switch: <Share2 size={20} />,
  Host: <Monitor size={20} />,
  Node: <Cpu size={20} />,
  PhysicalDisk: <HardDrive size={20} />,
}

const TYPE_COLORS = {
  Array: 'var(--accent-blue)',
  ArraySystem: 'var(--accent-blue)',
  Switch: 'var(--accent-purple)',
  Host: 'var(--accent-green)',
  Node: 'var(--muted)',
  PhysicalDisk: 'var(--accent-cyan)',
}

export default function DiscoveryResultGrid({ nodes, onNodeClick }) {
  if (nodes.length === 0) return null;

  return (
    <div style={{ padding: '20px 0' }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Discovered Assets ({nodes.length})
      </h3>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
        gap: 16 
      }}>
        {nodes.map(node => (
          <div 
            key={node.id} 
            className="glass-card rise-in" 
            onClick={() => onNodeClick(node)}
            style={{ 
              padding: 16, 
              cursor: 'pointer', 
              borderLeft: `4px solid ${TYPE_COLORS[node.type] || 'var(--line)'}`,
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)'; }}
            onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ color: TYPE_COLORS[node.type] || 'var(--muted)' }}>
                {TYPE_ICONS[node.type] || <Database size={20} />}
              </div>
              <div className="badge badge-info" style={{ fontSize: 9 }}>{node.type}</div>
            </div>
            
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: 'var(--foreground)' }}>
              {node.name || node.id}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
              {node.ip || node.id}
            </div>

            {node.entity_counts && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                {Object.entries(node.entity_counts).filter(([, v]) => v > 0).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground)' }}>{v}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'capitalize' }}>{k}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
