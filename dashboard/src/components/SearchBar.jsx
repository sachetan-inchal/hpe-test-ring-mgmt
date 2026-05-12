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
}) {
  const list = useMemo(() => (candidates || []).slice(0, 25), [candidates])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 240 }}>
          <span style={{
            position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--muted)', fontSize: 13, pointerEvents: 'none',
          }}>🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 30, fontSize: 12 }}
            placeholder="Search nodes, IPs, models…"
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        </div>
        {onPickModeChange && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!pickMode}
              onChange={e => onPickModeChange(e.target.checked)}
            />
            Pick
          </label>
        )}
        {onIsolateEnabled && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
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
            maxHeight: 160,
            overflowY: 'auto',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 6,
            minWidth: 260,
            fontSize: 11,
          }}
        >
          {list.map(n => (
            <label
              key={n.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isolateSelected?.has(n.id)}
                onChange={() => onToggleIsolateId?.(n.id)}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.name || n.id} <span style={{ color: 'var(--muted)' }}>({n.type})</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
