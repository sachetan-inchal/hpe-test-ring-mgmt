import { useMemo } from 'react'

export default function SearchBar({
  value,
  onChange,
  pickMode,
  onPickModeChange,
  isolateEnabled,
  onIsolateEnabled,
  candidates = [],
  isolateSelected,
  onToggleIsolateId,
  onSelectCandidate,
}) {
  const list = useMemo(() => (candidates || []).slice(0, 25), [candidates])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 240 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--muted)', pointerEvents: 'none' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            className="input"
            style={{ 
              paddingLeft: 32, fontSize: 13, background: 'var(--surface-1)', 
              border: '1px solid var(--line)', borderRadius: 10, width: '100%',
              transition: 'all 0.2s ease', outline: 'none', color: 'var(--foreground)'
            }}
            placeholder="Search nodes, IPs, models…"
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent-blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(88, 166, 255, 0.15)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none'; }}
          />

          {/* Suggestions Dropdown */}
          {value && value.trim().length > 0 && onSelectCandidate && (
            (() => {
              const q = value.toLowerCase();
              const filtered = (candidates || [])
                .filter(c => 
                  (c.name || '').toLowerCase().includes(q) || 
                  (c.id || '').toLowerCase().includes(q) || 
                  (c.type || '').toLowerCase().includes(q)
                )
                .slice(0, 8);
                
              if (filtered.length === 0) return null;
              
              return (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    background: 'var(--surface-1)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    zIndex: 100,
                    maxHeight: 240,
                    overflowY: 'auto',
                    padding: '4px 0'
                  }}
                >
                  {filtered.map(n => (
                    <div
                      key={n.id}
                      onMouseDown={(e) => {
                        // Use onMouseDown so it fires before onBlur
                        e.preventDefault();
                        onSelectCandidate(n.id);
                      }}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: 'var(--foreground)',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'background 0.2s',
                        borderBottom: '1px solid rgba(255,255,255,0.05)'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontWeight: 600 }}>{n.name || n.id}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>Category: {n.type || n.category} ({n.id})</span>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
        
        {onPickModeChange && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', cursor: 'pointer', padding: '6px 10px', background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--line)' }}>
            <input
              type="checkbox"
              style={{ accentColor: 'var(--accent-blue)', cursor: 'pointer' }}
              checked={!!pickMode}
              onChange={e => onPickModeChange(e.target.checked)}
            />
            Pick
          </label>
        )}
        
        {onIsolateEnabled && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: isolateSelected?.size > 0 ? 'var(--foreground)' : 'var(--muted)', cursor: isolateSelected?.size > 0 ? 'pointer' : 'not-allowed', padding: '6px 10px', background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--line)', opacity: isolateSelected?.size > 0 ? 1 : 0.6 }}>
            <input
              type="checkbox"
              style={{ accentColor: 'var(--accent-purple)', cursor: isolateSelected?.size > 0 ? 'pointer' : 'not-allowed' }}
              checked={!!isolateEnabled}
              onChange={e => onIsolateEnabled(e.target.checked)}
              disabled={!isolateSelected || isolateSelected.size === 0}
            />
            Isolate
          </label>
        )}
      </div>
      
      {pickMode && list.length > 0 && (
        <div
          style={{
            maxHeight: 180,
            overflowY: 'auto',
            background: 'var(--surface-1)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 8,
            minWidth: 260,
            fontSize: 12,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
            zIndex: 50,
            position: 'absolute',
            marginTop: 40
          }}
        >
          {list.map(n => (
            <label
              key={n.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <input
                type="checkbox"
                style={{ accentColor: 'var(--accent-blue)', cursor: 'pointer' }}
                checked={isolateSelected?.has(n.id)}
                onChange={() => onToggleIsolateId?.(n.id)}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>
                {n.name || n.id} <span style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: 4 }}>({n.type})</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
