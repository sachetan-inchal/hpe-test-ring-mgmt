/**
 * NodeTerminal.jsx
 * Cisco Packet Tracer-style interactive terminal for each SAN device.
 * Opens as a modal overlay. Supports HPE CLI, Linux bash, Brocade switch, and Windows PowerShell.
 *
 * Implements a pure, inline-rendered terminal stream:
 *   - No bottom input text box! You type directly onto the terminal output area.
 *   - Hidden input element captures focus on click, with standard IME, copy-paste, and mobile support.
 *   - Authentically simulates SSH logins (yes/no host key warning confirm, completely silent password masking).
 *   - Premium design aesthetics with blinking terminal block cursor.
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

export default function NodeTerminal({ node, apiBase, onClose }) {
  const kind = getDeviceKind(node)
  const hints = HINT_COMMANDS[kind] || HINT_COMMANDS.host_linux

  // SSH states: 'init' | 'awaiting_yes_no' | 'awaiting_password' | 'connected'
  const [sshState, setSshState]     = useState('init')
  const [handshake, setHandshake]   = useState(null)
  const [prompt, setPrompt]         = useState('')

  const [lines, setLines]   = useState([])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  const addLine = useCallback((type, text) =>
    setLines(prev => [...prev, { type, text }]), [])

  // Focus utility
  const focusInput = () => {
    inputRef.current?.focus()
  }

  // ── Boot: Fetch SSH Metadata & Simulate Login ──────────────────────────────
  useEffect(() => {
    const boot = async () => {
      try {
        const res = await fetch(`${apiBase}/api/sim/ssh/connect/${node.ip}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setHandshake(data)

        const loginUser = data.login_user || 'root'
        const devName = data.name || node.ip
        addLine('ssh', `ssh ${loginUser}@${devName}`)

        if (data.key_type) {
          addLine('warn', `Warning: the ${data.key_type} host key for '${devName}' differs from the key for the IP address '${node.ip}'`)
          setPrompt('Are you sure you want to continue connecting (yes/no)? ')
          setSshState('awaiting_yes_no')
        } else {
          setPrompt(data.password_prompt || 'Password: ')
          setSshState('awaiting_password')
        }
      } catch {
        // Fallback: connect directly
        addLine('info', `Connected to ${node.name || node.ip} (${node.ip})`)
        addLine('info', `Device type: ${node.type || kind}`)
        addLine('info', 'Type "help" or "?" for available commands.')
        addLine('out', '')
        setPrompt(getDefaultPrompt(kind, node))
        setSshState('connected')
      }
    }
    boot()
    focusInput()
  }, []) // eslint-disable-line

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, sshState, prompt, input])

  // Focus input automatically on transitions
  useEffect(() => {
    focusInput()
  }, [sshState])

  // ── Submit Input Handler (Handles yes/no confirmation, masked passwords, CLI commands) ──
  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = input.trim()
      const currentVal = input
      setInput('')

      if (sshState === 'awaiting_yes_no') {
        // Render completed line
        addLine('cmd', `${prompt}${currentVal}`)
        if (trimmed.toLowerCase() === 'yes') {
          setPrompt(handshake?.password_prompt || 'Password: ')
          setSshState('awaiting_password')
        } else if (trimmed.toLowerCase() === 'no') {
          addLine('error', 'Host key verification failed. Connection closed.')
          setPrompt('Connection closed.')
        } else {
          addLine('error', "Please type 'yes' or 'no'.")
        }
        return
      }

      if (sshState === 'awaiting_password') {
        // Authentic Linux SSH password input displays absolutely NOTHING as you type
        // Output prompt followed by empty space (or asterisk masking to verify submission)
        addLine('cmd', `${prompt}`)

        const devName = handshake?.name || node.name || node.ip
        const loginUser = handshake?.login_user || 'root'

        if (kind === 'switch') {
          addLine('out', `${devName}:FID100:admin> `)
          setPrompt(`${devName}:FID100:admin> `)
        } else if (kind === 'array') {
          addLine('out', `root@${devName}:~# `)
          setPrompt(`root@${devName}:~# `)
        } else {
          addLine('info', `Linux ${devName} — logged in as ${loginUser}`)
          addLine('out', '')
          setPrompt(`root@${devName}:~$ `)
        }

        setSshState('connected')
        return
      }

      if (sshState === 'connected') {
        if (!trimmed) {
          addLine('cmd', prompt)
          return
        }

        addLine('cmd', `${prompt}${trimmed}`)
        setHistory(prev => [trimmed, ...prev.slice(0, 49)])
        setHistIdx(-1)
        setLoading(true)

        try {
          const res = await fetch(`${apiBase}/api/sim/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: node.ip, command: trimmed }),
          })
          const data = await res.json()
          const output = data.output || data.error || 'No output'
          output.split('\n').forEach(line => addLine('out', line))
          addLine('out', '')
        } catch (err) {
          addLine('error', `Error: ${err.message}`)
        } finally {
          setLoading(false)
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (sshState !== 'connected') return
      const newIdx = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(newIdx)
      setInput(history[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (sshState !== 'connected') return
      const newIdx = Math.max(histIdx - 1, -1)
      setHistIdx(newIdx)
      setInput(newIdx === -1 ? '' : history[newIdx] || '')
    }
  }

  // ── Quick Hints Auto-Execution ─────────────────────────────────────────────
  const runHint = async (cmd) => {
    if (sshState !== 'connected' || loading) return
    addLine('cmd', `${prompt}${cmd}`)
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/sim/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: node.ip, command: cmd }),
      })
      const data = await res.json()
      const output = data.output || data.error || 'No output'
      output.split('\n').forEach(line => addLine('out', line))
      addLine('out', '')
    } catch (err) {
      addLine('error', `Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

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
      {/* Dynamic Keyframe style for blinking terminal cursor */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .term-cursor {
          display: inline-block;
          width: 8px;
          height: 15px;
          background: #3fb950;
          margin-left: 2px;
          animation: blink 1s step-start infinite;
          vertical-align: middle;
        }
      `}} />

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
        }}
      >
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

        {/* ── Quick command pills (Only available when connected) ── */}
        {sshState === 'connected' && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 14px',
            background: '#0d1117', borderBottom: '1px solid #21262d',
          }}>
            {hints.map(cmd => (
              <button
                key={cmd}
                onClick={() => runHint(cmd)}
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

        {/* ── Terminal body (captures clicks to keep focus on hidden input) ── */}
        <div
          style={{
            flex: 1, overflowY: 'auto', padding: '16px 18px',
            fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.8,
            cursor: 'text',
            position: 'relative',
          }}
          onClick={focusInput}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ color: COL[l.type] || '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {l.text}
            </div>
          ))}

          {/* Active Inline Input Line */}
          {prompt !== 'Connection closed.' && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', color: '#e6edf3' }}>
              <span style={{ color: sshState === 'connected' ? '#39c5cf' : '#e3b341', marginRight: 8, whiteSpace: 'pre' }}>
                {prompt}
              </span>
              <span style={{ color: '#e6edf3', whiteSpace: 'pre' }}>
                {sshState === 'awaiting_password' ? '' : input}
              </span>
              <span className="term-cursor" />
            </div>
          )}

          {loading && (
            <div style={{ color: '#58a6ff', fontSize: 11, marginTop: 6 }}>
              <span className="pulse-dot blue" style={{ marginRight: 6 }} />executing…
            </div>
          )}

          {/* Invisible input element that processes typing */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || prompt === 'Connection closed.'}
            style={{
              position: 'absolute',
              opacity: 0,
              pointerEvents: 'none',
              width: 0,
              height: 0,
              border: 'none',
              outline: 'none',
            }}
          />

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
