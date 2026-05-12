import { useState, useRef, useEffect } from 'react'

const PRESETS = {
  Arrays: [
    'Summarize all ArraySystem nodes and their capacity fields',
    'List arrays with config_type and node_count',
    'Which arrays have REMOTE_COPY_PEER relationships?',
  ],
  Hosts: [
    'List all Host nodes and their ip_address and os_name',
    'Which hosts CONNECTS_TO which arrays?',
  ],
  Network: [
    'List all switches and their serial numbers',
    'Show all Cage nodes and drive_count',
    'Count PhysicalDisk nodes by state',
  ],
}

export default function RadialMenu({ onPickPrompt, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        title="Categorized SAN prompts"
      >
        ◎ Queries
      </button>
      {open && (
        <div
          className="radial-pop"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            minWidth: 280,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 10,
            zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {Object.entries(PRESETS).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 6 }}>
                {cat.toUpperCase()}
              </div>
              {items.map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    onPickPrompt(q)
                    setOpen(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    marginBottom: 4,
                    fontSize: 11,
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'var(--surface-1)',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
