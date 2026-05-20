import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Query definitions ────────────────────────────────────────────────────────
const QUERY_GROUPS = {
  HOSTS: {
    label: 'HOSTS',
    color: '#01A982',
    darkColor: '#008f6e',
    icon: '🖥',
    queries: [
      {
        id: 'host_zoned_arrays',
        label: 'List zoned Arrays',
        template: 'Given host {host}, list all arrays that are zoned with it.',
        fields: [{ key: 'host', label: 'Host Name', type: 'text', placeholder: 'e.g. host-lnx-222' }],
      },
      {
        id: 'host_hba',
        label: 'HBA details: Driver/FW',
        template: 'Given host {host}, list HBA detail, driver and firmware version.',
        fields: [{ key: 'host', label: 'Host Name', type: 'text', placeholder: 'e.g. host-lnx-114' }],
      },
      {
        id: 'host_switch',
        label: 'Switch connection',
        template: 'Given host {host}, list to which switch it is connected.',
        fields: [{ key: 'host', label: 'Host Name', type: 'text', placeholder: 'e.g. host-lnx-132' }],
      },
    ],
  },
  ARRAYS: {
    label: 'ARRAYS',
    color: '#CF5C36',
    darkColor: '#b04528',
    icon: '🗄',
    queries: [
      {
        id: 'array_hosts_os',
        label: 'Hosts + OS zoned',
        template: 'Given array {array}, list all hosts along with type of OS that are zoned with it.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'array_protocols',
        label: 'Supported Protocols',
        template: 'For array {array}, list all protocols that are supported.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'array_switched',
        label: 'Switched / Switchless?',
        template: 'Given array {array}, list whether it is switched or switchless.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'list_switchless',
        label: 'All switchless arrays',
        template: 'List all arrays that are switchless.',
        fields: [],
      },
      {
        id: 'list_switched',
        label: 'All switched arrays',
        template: 'List all arrays that are switched.',
        fields: [],
      },
      {
        id: 'nvme_tcp',
        label: 'NVMe/TCP capable arrays',
        template: 'List all arrays that support NVMe/TCP protocol related tests.',
        fields: [],
      },
      {
        id: 'cap_200tb',
        label: 'Capacity > 200TB',
        template: 'List arrays that have more than {tb}TB usable space.',
        fields: [{ key: 'tb', label: 'Threshold (TB)', type: 'number', placeholder: '200' }],
      },
      {
        id: 'nodes_linux',
        label: '4 nodes + 3 Linux hosts',
        template: 'List arrays that have {nodes} nodes and more than {linux} Linux hosts.',
        fields: [
          { key: 'nodes', label: 'Min Nodes', type: 'number', placeholder: '4' },
          { key: 'linux', label: 'Min Linux Hosts', type: 'number', placeholder: '3' },
        ],
      },
      {
        id: 'location',
        label: 'Location: CXO_L2 Row #24',
        template: 'List arrays and hosts that are in {location}.',
        fields: [{ key: 'location', label: 'Location', type: 'text', placeholder: 'CXO_L2, Row # 24' }],
      },
      {
        id: 'switch_connection',
        label: 'Connected to switch',
        template: 'List hosts and arrays that are connected to switch {switch}.',
        fields: [{ key: 'switch', label: 'Switch Name', type: 'text', placeholder: 'c3-hp5930-03' }],
      },
      {
        id: 'hop_count',
        label: 'Hop count per host',
        template: 'Given array {array}, list all its hosts along with their hop count.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'nodes_count',
        label: 'How many nodes?',
        template: 'Given array {array}, list how many nodes it has.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'cage_health',
        label: 'Cages & cage health',
        template: 'Given array {array}, list how many cages, cage health, internal vs external cages.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'pd_details',
        label: 'PD count, model & health',
        template: 'Given array {array}, list PD count, PD model, capacity, compatible models, degraded/failed count, and 2X capacity support.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'switch_state',
        label: 'Switch state',
        template: 'Given array {array}, list the switch state.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'tpd_version',
        label: "TPD version",
        template: "Given array {array}, what is the TPD version?",
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'sfp_speed',
        label: 'SFP speed & count',
        template: 'Given array {array}, mention speed of SFP and count.',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'online_upgrade',
        label: 'Online upgrade supported?',
        template: 'Given array {array}, is online upgrade supported?',
        fields: [{ key: 'array', label: 'Array Name', type: 'text', placeholder: 'e.g. PROD-A' }],
      },
      {
        id: 'tpd_10x',
        label: 'Running 10.0.x TPD',
        template: 'List arrays that are running 10.0.x TPD version.',
        fields: [],
      },
      {
        id: 'online_upgrade_list',
        label: 'Capable of online upgrade',
        template: 'List arrays that are capable of performing online upgrade.',
        fields: [],
      },
      {
        id: 'failed_pd_list',
        label: 'Arrays with failed PDs',
        template: 'List arrays that have one or more failed PDs.',
        fields: [],
      },
    ],
  },
  CHATBOT: {
    label: 'CHATBOT',
    color: '#5B5EA6',
    darkColor: '#4a4d8a',
    icon: '💬',
    queries: [],
    isCenter: true,
  },
}

// ─── Sub-menu panel ───────────────────────────────────────────────────────────
function QueryPanel({ group, onSend, onClose }) {
  const [fieldValues, setFieldValues] = useState({})
  const [activeQuery, setActiveQuery] = useState(null)
  const [page, setPage] = useState(0)

  const PAGE_SIZE = 6
  const queries = group.queries
  const totalPages = Math.ceil(queries.length / PAGE_SIZE)
  const pageQueries = queries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const buildQuery = (q) => {
    let text = q.template
    q.fields.forEach(f => {
      const val = fieldValues[f.key] || f.placeholder || `{${f.key}}`
      text = text.replace(`{${f.key}}`, val)
    })
    return text
  }

  const handleApply = (q) => {
    if (q.fields.length === 0) {
      onSend(buildQuery(q))
      onClose()
      return
    }
    if (activeQuery?.id === q.id) {
      onSend(buildQuery(q))
      onClose()
    } else {
      setActiveQuery(q)
      const defaults = {}
      q.fields.forEach(f => { defaults[f.key] = '' })
      setFieldValues(defaults)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      pointerEvents: 'none',
    }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          pointerEvents: 'all',
          width: 340, maxHeight: '80vh',
          background: 'rgba(13,17,23,0.97)',
          border: `1px solid ${group.color}44`,
          borderRadius: 16,
          boxShadow: `0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px ${group.color}22`,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideInRight 0.2s ease',
          marginRight: 24,
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          background: `linear-gradient(135deg, ${group.color}22, ${group.darkColor}11)`,
          borderBottom: `1px solid ${group.color}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>{group.icon}</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: group.color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {group.label} Queries
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '10px 14px', overflowY: 'auto', flex: 1 }}>
          {/* Query list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pageQueries.map(q => (
              <div key={q.id}>
                <button
                  onClick={() => handleApply(q)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 12px',
                    background: activeQuery?.id === q.id ? `${group.color}18` : 'var(--surface-2)',
                    border: `1px solid ${activeQuery?.id === q.id ? group.color + '55' : 'var(--line)'}`,
                    borderRadius: 8, cursor: 'pointer', color: 'var(--foreground)',
                    fontSize: 12, fontFamily: 'var(--font-sans)',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  }}
                  onMouseOver={e => { if (activeQuery?.id !== q.id) e.currentTarget.style.borderColor = group.color + '44' }}
                  onMouseOut={e => { if (activeQuery?.id !== q.id) e.currentTarget.style.borderColor = 'var(--line)' }}
                >
                  <span>{q.label}</span>
                  {q.fields.length > 0 && <span style={{ fontSize: 9, color: 'var(--muted)', background: 'var(--surface-3)', borderRadius: 4, padding: '1px 5px' }}>params</span>}
                  {q.fields.length === 0 && <span style={{ fontSize: 9, color: group.color, background: `${group.color}18`, borderRadius: 4, padding: '1px 5px' }}>quick</span>}
                </button>

                {/* Inline field editor */}
                {activeQuery?.id === q.id && q.fields.length > 0 && (
                  <div style={{
                    margin: '4px 0 4px 8px', padding: '10px 12px',
                    background: `${group.color}0a`,
                    border: `1px solid ${group.color}33`,
                    borderRadius: 8,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {q.fields.map(f => (
                      <div key={f.key}>
                        <label style={{ fontSize: 10, color: group.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
                          {f.label}
                        </label>
                        <input
                          type={f.type === 'number' ? 'number' : 'text'}
                          placeholder={f.placeholder}
                          value={fieldValues[f.key] || ''}
                          onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                          autoFocus
                          style={{
                            width: '100%', padding: '6px 10px', fontSize: 12,
                            background: 'var(--surface-3)', border: `1px solid ${group.color}44`,
                            borderRadius: 6, color: 'var(--foreground)', outline: 'none',
                            fontFamily: 'var(--font-sans)',
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') handleApply(q) }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => handleApply(q)}
                      style={{
                        padding: '6px 12px', background: group.color, border: 'none',
                        borderRadius: 6, color: 'white', fontSize: 11, fontWeight: 700,
                        cursor: 'pointer', alignSelf: 'flex-end',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Apply ↵
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: '4px 10px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--muted)', cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: 11 }}>‹ Prev</button>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                style={{ padding: '4px 10px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--muted)', cursor: page === totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: 11 }}>Next ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SVG Arc helpers ──────────────────────────────────────────────────────────
function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r1, r2, startDeg, endDeg) {
  const s1 = polarToXY(cx, cy, r2, startDeg)
  const e1 = polarToXY(cx, cy, r2, endDeg)
  const s2 = polarToXY(cx, cy, r1, endDeg)
  const e2 = polarToXY(cx, cy, r1, startDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s1.x} ${s1.y} A ${r2} ${r2} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${r1} ${r1} 0 ${large} 0 ${e2.x} ${e2.y} Z`
}

// ─── Main RadialMenu ──────────────────────────────────────────────────────────
export default function RadialMenu({ onSend }) {
  const [activeGroup, setActiveGroup] = useState(null)
  const [hoveredSlice, setHoveredSlice] = useState(null)

  const CX = 160, CY = 160, R_INNER = 52, R_OUTER = 148

  const slices = [
    { key: 'HOSTS', startDeg: -60, endDeg: 60 },
    { key: 'ARRAYS', startDeg: 60, endDeg: 180 },
    { key: 'CHATBOT', startDeg: 180, endDeg: 300, isCenter: true },
  ]

  const handleSliceClick = (key) => {
    if (key === 'CHATBOT') { setActiveGroup(null); return }
    setActiveGroup(activeGroup === key ? null : key)
  }

  return (
    <>
      <style>{`
        @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes radialPop { from { transform: scale(0.88); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .radial-slice { transition: filter 0.18s, transform 0.18s; transform-origin: 160px 160px; cursor: pointer; }
        .radial-slice:hover { filter: brightness(1.25); }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ animation: 'radialPop 0.35s cubic-bezier(0.34,1.56,0.64,1)', position: 'relative' }}>
          <svg width={320} height={320} viewBox="0 0 320 320">
            <defs>
              {slices.map(s => {
                const g = QUERY_GROUPS[s.key]
                return (
                  <radialGradient key={s.key} id={`grad-${s.key}`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={g.color} stopOpacity="0.8" />
                    <stop offset="100%" stopColor={g.darkColor} stopOpacity="0.95" />
                  </radialGradient>
                )
              })}
            </defs>

            {/* Background ring glow */}
            <circle cx={CX} cy={CY} r={R_OUTER + 4} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" />
            <circle cx={CX} cy={CY} r={R_INNER - 2} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />

            {/* Slices */}
            {slices.map(s => {
              const g = QUERY_GROUPS[s.key]
              const isActive = activeGroup === s.key
              const isHovered = hoveredSlice === s.key
              const midDeg = (s.startDeg + s.endDeg) / 2
              const labelPos = polarToXY(CX, CY, (R_INNER + R_OUTER) / 2, midDeg)
              const iconPos = polarToXY(CX, CY, (R_INNER + R_OUTER) / 2 + 18, midDeg)
              return (
                <g key={s.key}
                  className="radial-slice"
                  onClick={() => handleSliceClick(s.key)}
                  onMouseEnter={() => setHoveredSlice(s.key)}
                  onMouseLeave={() => setHoveredSlice(null)}
                >
                  <path
                    d={arcPath(CX, CY, R_INNER, R_OUTER, s.startDeg + 2, s.endDeg - 2)}
                    fill={isActive ? g.color : `url(#grad-${s.key})`}
                    stroke={isActive ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)'}
                    strokeWidth={isActive ? 2 : 1}
                    opacity={isActive ? 1 : isHovered ? 0.9 : 0.75}
                  />
                  {/* Icon */}
                  <text x={iconPos.x} y={iconPos.y - 14} textAnchor="middle" fontSize="20" dominantBaseline="middle" style={{ pointerEvents: 'none' }}>
                    {g.icon}
                  </text>
                  {/* Label */}
                  <text x={labelPos.x} y={labelPos.y + 10} textAnchor="middle" fontSize="10" fontWeight="700"
                    fill="white" letterSpacing="1.5" dominantBaseline="middle" style={{ pointerEvents: 'none', textTransform: 'uppercase', fontFamily: 'sans-serif' }}>
                    {g.label}
                  </text>
                  {/* Query count badge */}
                  {g.queries.length > 0 && (
                    <text x={labelPos.x} y={labelPos.y + 24} textAnchor="middle" fontSize="9"
                      fill="rgba(255,255,255,0.6)" dominantBaseline="middle" style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}>
                      {g.queries.length} queries
                    </text>
                  )}
                  {/* Active arc indicator */}
                  {isActive && (
                    <path
                      d={arcPath(CX, CY, R_OUTER + 2, R_OUTER + 6, s.startDeg + 4, s.endDeg - 4)}
                      fill={g.color}
                      opacity="0.9"
                    />
                  )}
                </g>
              )
            })}

            {/* Center hub */}
            <circle cx={CX} cy={CY} r={R_INNER - 4} fill="radialGradient" style={{ fill: '#0d1117' }} />
            <circle cx={CX} cy={CY} r={R_INNER - 4} fill="url(#centerHub)" />
            <defs>
              <radialGradient id="centerHub" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1f2937" />
                <stop offset="100%" stopColor="#0d1117" />
              </radialGradient>
            </defs>
            <circle cx={CX} cy={CY} r={R_INNER - 4} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
            <text x={CX} y={CY - 6} textAnchor="middle" fontSize="18" dominantBaseline="middle" style={{ fontFamily: 'sans-serif' }}>⚙</text>
            <text x={CX} y={CY + 12} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.5)"
              dominantBaseline="middle" style={{ fontFamily: 'sans-serif', letterSpacing: '1px' }}>QUICK</text>
            <text x={CX} y={CY + 23} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.5)"
              dominantBaseline="middle" style={{ fontFamily: 'sans-serif', letterSpacing: '1px' }}>QUERIES</text>

            {/* Divider lines */}
            {slices.map(s => {
              const p = polarToXY(CX, CY, R_OUTER, s.startDeg)
              const p2 = polarToXY(CX, CY, R_INNER, s.startDeg)
              return <line key={s.key} x1={p2.x} y1={p2.y} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            })}
          </svg>

          {/* Active group label below */}
          {activeGroup && (
            <div style={{ textAlign: 'center', marginTop: -8, fontSize: 11, color: QUERY_GROUPS[activeGroup].color, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {QUERY_GROUPS[activeGroup].label} — select a query →
            </div>
          )}
        </div>
      </div>

      {/* Panel */}
      {activeGroup && QUERY_GROUPS[activeGroup].queries.length > 0 && (
        <QueryPanel
          group={QUERY_GROUPS[activeGroup]}
          onSend={onSend}
          onClose={() => setActiveGroup(null)}
        />
      )}
    </>
  )
}
