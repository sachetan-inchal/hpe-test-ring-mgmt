import { useState, useEffect } from "react";

export default function NodeCard({ node, connections = [], onDecommissionToggle, onUpdateNode }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    setIsEditing(false);
  }, [node?.id]);

  if (!node) {
    return (
      <aside className="glass-card" style={{ height: '100%', padding: '24px', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <svg style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.3 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
          </svg>
          <p>Select a node to inspect details</p>
        </div>
      </aside>
    );
  }

  // Group dynamic properties to display
  const excludeProps = ['id', 'name', 'type', 'status', 'category', 'parentId', 'isDecommissioned'];
  const details = Object.entries(node).filter(([k, v]) => !excludeProps.includes(k) && v !== undefined);

  return (
    <aside className="glass-card" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px' }}>
      {node.isDecommissioned && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, background: 'rgba(248,81,73,0.15)', padding: '4px 0', textAlign: 'center', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--accent-rose)' }}>
          Decommissioned
        </div>
      )}

      <div style={{ marginBottom: 16, marginTop: node.isDecommissioned ? 12 : 12, display: 'inline-flex', width: 'max-content', alignItems: 'center', gap: 8, borderRadius: 20, border: '1px solid', padding: '4px 12px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', 
        ...(node.status === 'normal' ? { background: 'rgba(63,185,80,0.11)', color: 'var(--status-ok)', borderColor: 'rgba(63,185,80,0.38)' } :
            node.status === 'degraded' ? { background: 'rgba(210,153,34,0.13)', color: 'var(--status-warn)', borderColor: 'rgba(210,153,34,0.4)' } :
            { background: 'rgba(248,81,73,0.11)', color: 'var(--status-critical)', borderColor: 'rgba(248,81,73,0.35)' })
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', 
          background: node.status === 'normal' ? 'var(--status-ok)' : node.status === 'degraded' ? 'var(--status-warn)' : 'var(--status-critical)' 
        }} />
        {node.status || 'normal'}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <p style={{ marginBottom: 4, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted)' }}>{node.category === 'main' ? 'Main Component' : 'Sub Component'} • {node.type}</p>
          <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--foreground)' }}>{node.name}</h2>
          <p style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>{node.id}</p>
        </div>
      </div>

      {node.parentId && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          <svg style={{ width: 14, height: 14 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          Parent: <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{node.parentId}</span>
        </div>
      )}

      <div style={{ margin: '16px 0', height: 1, width: '100%', background: 'var(--line)' }} />

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted)' }}>Properties</h3>
          {!isEditing && onUpdateNode && (
            <button 
              onClick={() => {
                const initialForm = {};
                details.forEach(([k, v]) => { initialForm[k] = v; });
                setEditForm(initialForm);
                setIsEditing(true);
              }}
              style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Edit Properties
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
          {details.length > 0 ? details.map(([key, value]) => (
            <div key={key} style={{ borderRadius: 8, border: `1px solid ${isEditing ? 'var(--accent-blue)' : 'var(--line)'}`, background: 'var(--surface-1)', padding: 10 }}>
              <p style={{ marginBottom: 4, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </p>
              {isEditing ? (
                <input
                  className="input"
                  style={{ width: '100%', fontSize: 14, fontWeight: 500, padding: '4px 8px' }}
                  value={editForm[key] !== undefined ? String(editForm[key]) : ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const parsedVal = !isNaN(Number(val)) && val.trim() !== '' ? Number(val) : val;
                    setEditForm(prev => ({ ...prev, [key]: parsedVal }));
                  }}
                />
              ) : (
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(value)}>
                  {String(value)}
                </p>
              )}
            </div>
          )) : (
             <p style={{ gridColumn: 'span 2', fontSize: 14, color: 'var(--muted)' }}>No additional properties available.</p>
          )}
        </div>

        {isEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
            <button 
              onClick={() => setIsEditing(false)}
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                if (onUpdateNode) onUpdateNode(node.id, editForm);
                setIsEditing(false);
              }}
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Save Details
            </button>
          </div>
        )}

        {!isEditing && node.category === 'main' && connections.length > 0 && (
          <>
            <h3 style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted)' }}>Related Devices</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {connections.map((conn) => (
                <div key={conn.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-1)', padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: conn.status === 'normal' ? 'var(--status-ok)' : conn.status === 'degraded' ? 'var(--status-warn)' : 'var(--status-critical)' }} />
                    <span style={{ fontSize: 14, color: 'var(--foreground)' }}>{conn.name}</span>
                  </div>
                  <span style={{ borderRadius: 4, background: 'var(--surface-2)', padding: '2px 6px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>{conn.type}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ margin: '16px 0', height: 1, width: '100%', background: 'var(--line)' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        {onDecommissionToggle && node.category === 'main' && (
          <button
            onClick={() => onDecommissionToggle(node.id)}
            className={`btn ${node.isDecommissioned ? 'btn-primary' : 'btn-danger'}`}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {node.isDecommissioned ? 'Restore Device' : 'Decommission Device'}
          </button>
        )}
      </div>
    </aside>
  );
}
