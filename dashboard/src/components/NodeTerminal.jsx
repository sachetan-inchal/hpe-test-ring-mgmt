/**
 * NodeTerminal.jsx
 * Cisco Packet Tracer-style interactive terminal for each SAN device.
 * Opens as a modal overlay. Supports HPE CLI, Linux bash, and Windows PowerShell.
 * Sends commands to the simulator via /api/sim/exec.
 */
import { useState, useEffect, useRef } from 'react'

const TYPE_PROMPT = {
  Array:       'cli% ',
  ArraySystem: 'cli% ',
  Switch:      'cli% ',
  Host:        '$ ',
}

const TYPE_HINT_COMMANDS = {
  Array: ['showsys', 'shownode', 'showport', 'showswitch', 'showhost', 'showcage', 'showpd', 'showpd -s', 'showversion -b', 'lscpu'],
  ArraySystem: ['showsys', 'shownode', 'showport', 'showswitch', 'showhost', 'showcage', 'showpd', 'showpd -s', 'showversion -b', 'lscpu'],
  Switch: ['showswitch', 'showport', 'showsys'],
  Host: ['uname -a', 'cat /etc/os-release', 'lsblk', 'ip addr show', 'multipath -ll', 'dmidecode -s bios-version', 'hostname', 'help'],
}

// Detect if host is Windows from OS name
function isWindowsHost(node) {
  return node?.os_name?.toLowerCase().includes('windows') ||
    node?.device_type === 'windows_host'
}

function getPrompt(node) {
  if (isWindowsHost(node)) return 'PS C:\\> '
  return TYPE_PROMPT[node?.type] || '$ '
}

function getHintCommands(node) {
  if (isWindowsHost(node)) {
    return [
      'Get-PhysicalDisk | Select-Object DeviceId, Model, FirmwareVersion',
      'wmic bios get smbiosbiosversion',
      'Get-ComputerInfo',
      'Get-NetAdapter',
      'Get-HBaPort',
      'hostname',
    ]
  }
  return TYPE_HINT_COMMANDS[node?.type] || ['help']
}

export default function NodeTerminal({ node, apiBase, onClose }) {
  const [lines, setLines] = useState([
    { type: 'info', text: `Connected to ${node.name || node.id} (${node.ip})` },
    { type: 'info', text: `Device type: ${node.type} | OS: ${node.os_name || 'HPE CLI'}` },
    { type: 'info', text: `Type "help" or "?" for available commands.` },
    { type: 'out',  text: '' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const prompt = getPrompt(node)
  const hints = getHintCommands(node)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const executeCommand = async (cmd) => {
    const trimmed = cmd.trim()
    if (!trimmed) return

    setLines(prev => [...prev, { type: 'cmd', text: `${prompt}${trimmed}` }])
    setHistory(prev => [trimmed, ...prev.slice(0, 49)])
    setHistoryIdx(-1)
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
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      executeCommand(input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(newIdx)
      setInput(history[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(historyIdx - 1, -1)
      setHistoryIdx(newIdx)
      setInput(newIdx === -1 ? '' : history[newIdx] || '')
    }
  }

  const typeColor = { cmd: '#3fb950', out: '#c9d1d9', error: '#f85149', info: '#58a6ff', warn: '#d29922' }

  return (
    <div
      className="fade-in"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rise-in"
        style={{
          width: '100%', maxWidth: 860,
          background: '#0d1117',
          border: '1px solid var(--line-strong)',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '80vh',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Traffic-light title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={onClose} style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', border: 'none', cursor: 'pointer' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{node.name || node.id}</span>
            <span>—</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{node.ip}</span>
            <span style={{
              padding: '1px 7px', borderRadius: 20, fontSize: 9, fontWeight: 700,
              background: 'rgba(88, 166, 255, 0.15)', color: 'var(--accent-blue)',
              border: '1px solid rgba(88, 166, 255, 0.3)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>{node.type}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}>✕</button>
        </div>

        {/* Quick command pills */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 14px',
          background: 'var(--surface-1)', borderBottom: '1px solid var(--line)',
        }}>
          {hints.map(cmd => (
            <button
              key={cmd}
              onClick={() => executeCommand(cmd)}
              style={{
                padding: '2px 9px', borderRadius: 20,
                background: 'var(--surface-2)', border: '1px solid var(--line)',
                color: 'var(--muted)', fontSize: 10, cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => e.target.style.borderColor = 'var(--accent-blue)'}
              onMouseLeave={e => e.target.style.borderColor = 'var(--line)'}
            >
              {cmd}
            </button>
          ))}
        </div>

        {/* Terminal output */}
        <div
          style={{
            flex: 1, overflowY: 'auto', padding: '12px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8,
          }}
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ color: typeColor[l.type] || '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {l.text}
            </div>
          ))}
          {loading && (
            <div style={{ color: 'var(--accent-blue)', fontSize: 11 }}>
              <span className="pulse-dot blue" style={{ marginRight: 6 }} />executing...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          background: 'var(--surface-1)',
          borderTop: '1px solid var(--line)',
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
            placeholder={loading ? 'Running...' : 'Type a command…'}
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
      </div>
    </div>
  )
}
