/**
 * NodeTerminal.jsx
 * Cisco Packet Tracer-style interactive terminal for each SAN device.
 * Opens as a modal overlay. Supports HPE CLI, Linux bash, Brocade switch, and Windows PowerShell.
 *
 * SSH Login Flow (mirrors the real log file exactly):
 *   Array   → RSA key warning → yes/no prompt → Password: toast → cli% prompt
 *   Linux   → ECDSA key warning → yes/no prompt → root@host's password: toast → $ prompt
 *   Switch  → admin@host's password: toast (no key warning) → switch:FID100:admin> prompt
 *   Windows → direct connect, no SSH simulation
 */
import { useState, useEffect, useRef, useCallback } from 'react'

// ── Hint commands per device type ────────────────────────────────────────────
const HINT_COMMANDS = {
  array: [
    'showsys', 'shownode', 'showport', 'showswitch', 'showhost',
    'showcage', 'showpd', 'showpd -s', 'showpd -i',
    'showportdev ns -nohdtot 0:3:1', 'showversion -b', 'lscpu',
  ],
  switch: [
    'fabricshow', 'switchshow', 'help',
  ],
  host_linux: [
    'uname -a', 'cat /etc/os-release', 'hostname',
    'lsblk', 'ip addr show', 'multipath -ll',
    'dmidecode -s bios-version', 'dmidecode -s system-product-name',
    "systool -c fc_host -v | grep -E 'Class Device|port_state|port_name|speed'",
    "lspci -nnk | grep -A3 -i 'fibre|fc|emulex|qlogic|lpfc|qlgc'",
  ],
  host_windows: [
    'Get-PhysicalDisk | Select-Object DeviceId, Model, FirmwareVersion',
    'wmic bios get smbiosbiosversion',
    'Get-ComputerInfo', 'Get-NetAdapter', 'Get-HBaPort',
    'Get-WmiObject Win32_DiskDrive', 'hostname',
  ],
}

function getDeviceKind(node) {
  const t = (node?.type || '').toLowerCase()
  const os = (node?.os_name || node?.os || node?.device_type || '').toLowerCase()
  if (t === 'switch') return 'switch'
  if (t === 'array' || t === 'arraysystem') return 'array'
  if (os.includes('windows')) return 'host_windows'
  return 'host_linux'
}

function getDefaultPrompt(kind, node) {
  if (kind === 'switch') return `${node?.name || 'switch'}:FID100:admin> `
  if (kind === 'array') return 'cli% '
  if (kind === 'host_windows') return 'PS C:\\> '
  return '$ '
}

// ── Inline styles ─────────────────────────────────────────────────────────────
const COL = {
  cmd:  '#3fb950',
  out:  '#c9d1d9',
  error:'#f85149',
  info: '#58a6ff',
  warn: '#e3b341',
  ssh:  '#d2a8ff',
}

// ── Password Toast Modal ──────────────────────────────────────────────────────
function PasswordToast({ prompt, onSubmit }) {
  const [pw, setPw] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = () => {
    if (!pw) return
    onSubmit(pw)
    setPw('')
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 14,
    }}>
      <div style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: '24px 28px',
        minWidth: 340,
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 18 }}>🔐</span>
          <span style={{ color: '#e6edf3', fontWeight: 600, fontSize: 14 }}>SSH Authentication</span>
        </div>

        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: '#d2a8ff', marginBottom: 14,
          padding: '8px 10px',
          background: 'rgba(210,168,255,0.06)',
          borderRadius: 6,
          borderLeft: '2px solid #7c3aed',
        }}>
          {prompt}
        </div>

        <input
          ref={inputRef}
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Enter password…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#e6edf3',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            padding: '8px 12px',
            outline: 'none',
            marginBottom: 14,
          }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={submit}
            style={{
              padding: '7px 20px',
              background: 'linear-gradient(135deg, #238636, #2ea043)',
              border: 'none', borderRadius: 6,
              color: '#fff', fontWeight: 600, fontSize: 12,
              cursor: 'pointer',
              boxShadow: '0 0 12px rgba(46,160,67,0.3)',
            }}
          >
            Authenticate
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 10, color: '#484f58', textAlign: 'center' }}>
          Any password is accepted in simulation mode
        </div>
      </div>
    </div>
  )
}

// ── Yes/No inline prompt ──────────────────────────────────────────────────────
function YesNoPrompt({ onAnswer }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      fontFamily: 'var(--font-mono)', fontSize: 12,
    }}>
      <span style={{ color: '#e3b341' }}>Are you sure you want to continue connecting (yes/no)?</span>
      <button
        onClick={() => onAnswer('yes')}
        style={{
          padding: '2px 12px', borderRadius: 4,
          background: 'rgba(46,160,67,0.15)',
          border: '1px solid #2ea043', color: '#3fb950',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          cursor: 'pointer',
        }}
      >yes</button>
      <button
        onClick={() => onAnswer('no')}
        style={{
          padding: '2px 12px', borderRadius: 4,
          background: 'rgba(248,81,73,0.1)',
          border: '1px solid #f85149', color: '#f85149',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          cursor: 'pointer',
        }}
      >no</button>
    </div>
  )
}

// ── Main Terminal ─────────────────────────────────────────────────────────────
export default function NodeTerminal({ node, apiBase, onClose }) {
  const kind = getDeviceKind(node)
  const hints = HINT_COMMANDS[kind] || HINT_COMMANDS.host_linux

  // SSH state: 'init' | 'key_warning' | 'awaiting_yes_no' | 'awaiting_password' | 'connected'
  const [sshState, setSshState]     = useState('init')
  const [handshake, setHandshake]   = useState(null)  // metadata from /api/sim/ssh/connect
  const [prompt, setPrompt]         = useState(getDefaultPrompt(kind, node))

  const [lines, setLines]   = useState([])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  const addLine = useCallback((type, text) =>
    setLines(prev => [...prev, { type, text }]), [])

  // ── Boot: fetch SSH handshake data ─────────────────────────────────────────
  useEffect(() => {
    const boot = async () => {
      try {
        const res = await fetch(`${apiBase}/api/sim/ssh/connect/${node.ip}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setHandshake(data)
        // Use server-supplied prompt if available
        if (data.prompt) setPrompt(data.prompt)

        // Show the ssh command itself
        const loginUser = data.login_user || 'root'
        const devName = data.name || node.ip
        addLine('ssh', `ssh ${loginUser}@${devName}`)

        if (data.key_type) {
          // Show key warning, then ask yes/no
          addLine('warn', data.handshake_lines[0])
          setSshState('awaiting_yes_no')
        } else {
          // Switch: go straight to password
          setSshState('awaiting_password')
        }
      } catch {
        // Fallback: connect immediately
        addLine('info', `Connected to ${node.name || node.ip} (${node.ip})`)
        addLine('info', `Device type: ${node.type || kind}`)
        addLine('info', 'Type "help" or "?" for available commands.')
        addLine('out', '')
        setSshState('connected')
        inputRef.current?.focus()
      }
    }
    boot()
  }, []) // eslint-disable-line

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, sshState])

  // Focus input when connected
  useEffect(() => {
    if (sshState === 'connected') inputRef.current?.focus()
  }, [sshState])

  // ── SSH state handlers ─────────────────────────────────────────────────────
  const handleYesNo = useCallback((answer) => {
    addLine('out', `Are you sure you want to continue connecting (yes/no)? ${answer}`)
    if (answer === 'no') {
      addLine('error', 'Connection aborted.')
      setSshState('connected')   // allow re-try by closing
      return
    }
    // yes → go to password
    addLine('out', '')
    setSshState('awaiting_password')
  }, [addLine])

  const handlePassword = useCallback((_pw) => {
    const pwPrompt = handshake?.password_prompt || 'Password:'
    addLine('ssh', `${pwPrompt} ****`)
    addLine('out', '')

    // Show the authenticated shell banner
    const devName = handshake?.name || node.name || node.ip
    const loginUser = handshake?.login_user || 'root'
    if (kind === 'switch') {
      addLine('out', `${devName}:FID100:admin> `)
    } else if (kind === 'array') {
      addLine('out', `${loginUser}@${devName}:~# `)
    } else {
      addLine('info', `Linux ${devName} — logged in as ${loginUser}`)
    }
    addLine('out', '')
    setSshState('connected')
  }, [addLine, handshake, node, kind])

  // ── Command execution ──────────────────────────────────────────────────────
  const executeCommand = useCallback(async (cmd) => {
    const trimmed = cmd.trim()
    if (!trimmed) return

    setLines(prev => [...prev, { type: 'cmd', text: `${prompt}${trimmed}` }])
    setHistory(prev => [trimmed, ...prev.slice(0, 49)])
    setHistIdx(-1)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`${apiBase}/api/sim/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: node.ip, command: trimmed }),
      })
      const data = await res.json()
      const output = data.output || data.error || 'No output'
      const outLines = output.split('\n').map(l => ({ type: 'out', text: l }))
      setLines(prev => [...prev, ...outLines, { type: 'out', text: '' }])
    } catch (e) {
      setLines(prev => [...prev, { type: 'error', text: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }, [prompt, node.ip, apiBase])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      executeCommand(input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(newIdx)
      setInput(history[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(histIdx - 1, -1)
      setHistIdx(newIdx)
      setInput(newIdx === -1 ? '' : history[newIdx] || '')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const typeBadgeColor = {
    array:        { bg: 'rgba(88,166,255,0.15)', fg: '#58a6ff', border: 'rgba(88,166,255,0.3)' },
    switch:       { bg: 'rgba(63,185,80,0.15)',  fg: '#3fb950', border: 'rgba(63,185,80,0.3)' },
    host_linux:   { bg: 'rgba(210,168,255,0.15)',fg: '#d2a8ff', border: 'rgba(210,168,255,0.3)' },
    host_windows: { bg: 'rgba(57,197,207,0.15)', fg: '#39c5cf', border: 'rgba(57,197,207,0.3)' },
  }[kind] || { bg: 'rgba(88,166,255,0.15)', fg: '#58a6ff', border: 'rgba(88,166,255,0.3)' }

  return (
    <div
      className="fade-in"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rise-in"
        style={{
          width: '100%', maxWidth: 900,
          background: '#0d1117',
          border: '1px solid #21262d',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '82vh',
          boxShadow: '0 32px 90px rgba(0,0,0,0.8)',
          position: 'relative',   /* needed for PasswordToast */
        }}
      >
        {/* Password toast overlay */}
        {sshState === 'awaiting_password' && (
          <PasswordToast
            prompt={handshake?.password_prompt || 'Password:'}
            onSubmit={handlePassword}
          />
        )}

        {/* ── Title bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: '#161b22',
          borderBottom: '1px solid #21262d',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={onClose} style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', border: 'none', cursor: 'pointer' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#848d97' }}>
            <span style={{ color: '#e6edf3', fontWeight: 600 }}>{node.name || node.id}</span>
            <span>—</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{node.ip}</span>
            <span style={{
              padding: '1px 7px', borderRadius: 20, fontSize: 9, fontWeight: 700,
              background: typeBadgeColor.bg, color: typeBadgeColor.fg,
              border: `1px solid ${typeBadgeColor.border}`,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>{node.type || kind}</span>
            {/* SSH state indicator */}
            <span style={{
              padding: '1px 6px', borderRadius: 20, fontSize: 9,
              background: sshState === 'connected' ? 'rgba(63,185,80,0.15)' : 'rgba(227,179,65,0.15)',
              color: sshState === 'connected' ? '#3fb950' : '#e3b341',
              border: `1px solid ${sshState === 'connected' ? 'rgba(63,185,80,0.3)' : 'rgba(227,179,65,0.3)'}`,
            }}>
              {sshState === 'connected' ? '● SSH' : '○ Connecting…'}
            </span>
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#848d97', fontSize: 16 }}>✕</button>
        </div>

        {/* ── Quick command pills (only when connected) ── */}
        {sshState === 'connected' && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 14px',
            background: '#0d1117', borderBottom: '1px solid #21262d',
          }}>
            {hints.map(cmd => (
              <button
                key={cmd}
                onClick={() => executeCommand(cmd)}
                style={{
                  padding: '2px 9px', borderRadius: 20,
                  background: '#161b22', border: '1px solid #30363d',
                  color: '#848d97', fontSize: 10, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  transition: 'all 0.15s ease',
                  maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={cmd}
                onMouseEnter={e => { e.target.style.borderColor = typeBadgeColor.fg; e.target.style.color = typeBadgeColor.fg }}
                onMouseLeave={e => { e.target.style.borderColor = '#30363d'; e.target.style.color = '#848d97' }}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}

        {/* ── Terminal output ── */}
        <div
          style={{
            flex: 1, overflowY: 'auto', padding: '12px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8,
          }}
          onClick={() => sshState === 'connected' && inputRef.current?.focus()}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ color: COL[l.type] || '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {l.text}
            </div>
          ))}

          {/* Interactive yes/no prompt */}
          {sshState === 'awaiting_yes_no' && (
            <div style={{ marginTop: 6, marginBottom: 4 }}>
              <YesNoPrompt onAnswer={handleYesNo} />
            </div>
          )}

          {loading && (
            <div style={{ color: '#58a6ff', fontSize: 11 }}>
              <span className="pulse-dot blue" style={{ marginRight: 6 }} />executing…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Input bar (only when connected) ── */}
        {sshState === 'connected' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            background: '#0d1117',
            borderTop: '1px solid #21262d',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#39c5cf', flexShrink: 0 }}>
              {prompt}
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder={loading ? 'Running…' : 'Type a command…'}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e6edf3',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                caretColor: '#3fb950',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
