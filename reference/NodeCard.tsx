import { useState, useEffect } from "react";
import { TopologyNode } from "../lib/mockData";

interface NodeCardProps {
  node: TopologyNode | null;
  connections: TopologyNode[];
  onDecommissionToggle?: (id: string) => void;
  onUpdateNode?: (id: string, properties: Record<string, any>) => void;
}

export default function NodeCard({ node, connections, onDecommissionToggle, onUpdateNode }: NodeCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  useEffect(() => {
    setIsEditing(false);
  }, [node?.id]);

  if (!node) {
    return (
      <aside className="glass-card h-full p-6 text-[var(--muted)] flex items-center justify-center">
        <div className="text-center">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-30" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
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
    <aside className="glass-card relative flex h-full flex-col overflow-hidden p-5">
      {node.isDecommissioned && (
        <div className="absolute left-0 right-0 top-0 bg-[color-mix(in_oklab,var(--accent-rose)_15%,white)] py-1 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent-rose)]">
          Decommissioned
        </div>
      )}

      <div className={`mb-4 mt-3 inline-flex w-max items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
        node.status === 'normal' ? 'bg-[color-mix(in_oklab,var(--accent-green)_11%,white)] text-[var(--accent-green)] border-[color-mix(in_oklab,var(--accent-green)_38%,var(--line))]' :
        node.status === 'degraded' ? 'bg-[color-mix(in_oklab,var(--accent-amber)_13%,white)] text-[color-mix(in_oklab,var(--accent-amber)_90%,black)] border-[color-mix(in_oklab,var(--accent-amber)_40%,var(--line))]' :
        'bg-[color-mix(in_oklab,var(--accent-rose)_11%,white)] text-[var(--accent-rose)] border-[color-mix(in_oklab,var(--accent-rose)_35%,var(--line))]'
      }`}>
        <div className={`w-2 h-2 rounded-full ${
          node.status === 'normal' ? 'bg-[var(--accent-green)]' :
          node.status === 'degraded' ? 'bg-[var(--accent-amber)]' :
          'bg-[var(--accent-rose)]'
        }`} />
        {node.status}
      </div>

      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{node.category === 'main' ? 'Main Component' : 'Sub Component'} • {node.type}</p>
          <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]" style={{ fontFamily: "var(--font-playfair-display)" }}>{node.name}</h2>
          <p className="mt-1 text-sm font-semibold text-[var(--muted)]">{node.id}</p>
        </div>
      </div>

      {node.parentId && (
        <div className="mb-4 flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          Parent: <span className="font-semibold text-[var(--foreground)]">{node.parentId}</span>
        </div>
      )}

      <div className="my-4 h-px w-full bg-[var(--line)]" />

      <div className="flex-1 overflow-y-auto pr-2">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Properties</h3>
          {!isEditing && onUpdateNode && (
            <button 
              onClick={() => {
                const initialForm: Record<string, any> = {};
                details.forEach(([k, v]) => { initialForm[k] = v; });
                setEditForm(initialForm);
                setIsEditing(true);
              }}
              className="text-[10px] uppercase font-bold tracking-wider text-[var(--accent-blue)] hover:opacity-80"
            >
              Edit Properties
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {details.length > 0 ? details.map(([key, value]) => (
            <div key={key} className={`rounded-lg border bg-[var(--surface-1)] p-2.5 ${isEditing ? 'border-[var(--accent-blue)] ring-1 ring-[color-mix(in_oklab,var(--accent-blue)_20%,transparent)]' : 'border-[var(--line)]'}`}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </p>
              {isEditing ? (
                <input
                  className="input-dark w-full text-sm font-medium h-7 !px-2"
                  value={editForm[key] !== undefined ? String(editForm[key]) : ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const parsedVal = !isNaN(Number(val)) && val.trim() !== '' ? Number(val) : val;
                    setEditForm(prev => ({ ...prev, [key]: parsedVal }));
                  }}
                />
              ) : (
                <p className="truncate text-sm font-medium text-[var(--foreground)]" title={String(value)}>
                  {String(value)}
                </p>
              )}
            </div>
          )) : (
             <p className="col-span-2 text-sm text-[var(--muted)]">No additional properties available.</p>
          )}
        </div>

        {isEditing && (
          <div className="flex items-center gap-2 mb-6">
            <button 
              onClick={() => setIsEditing(false)}
              className="toolbar-btn flex-1 justify-center py-1.5"
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                if (onUpdateNode) onUpdateNode(node.id, editForm);
                setIsEditing(false);
              }}
              className="toolbar-btn primary flex-1 justify-center py-1.5"
            >
              Save Details
            </button>
          </div>
        )}

        {!isEditing && node.category === 'main' && connections.length > 0 && (
          <>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Related Devices</h3>
            <div className="space-y-2 mb-6">
              {connections.map((conn) => (
                <div key={conn.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${conn.status === 'normal' ? 'bg-[var(--accent-green)]' : conn.status === 'degraded' ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-rose)]'}`} />
                    <span className="text-sm text-[var(--foreground)]">{conn.name}</span>
                  </div>
                  <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{conn.type}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="my-4 h-px w-full bg-[var(--line)]" />

      <div className="flex justify-between items-center mt-auto">
        {onDecommissionToggle && node.category === 'main' && (
          <button
            onClick={() => onDecommissionToggle(node.id)}
            className={`toolbar-btn ${node.isDecommissioned ? 'primary' : 'danger'} w-full justify-center`}
          >
            {node.isDecommissioned ? 'Restore Device' : 'Decommission Device'}
          </button>
        )}
      </div>
    </aside>
  );
}