import { useState, useRef, useEffect, useCallback } from 'react'
import { Monitor, Play, RotateCcw, Server } from 'lucide-react'

const COMMANDS = [
  { label: 'showsys', desc: 'System overview' }, { label: 'shownode', desc: 'Node details' },
  { label: 'showport', desc: 'Port info' }, { label: 'showpd', desc: 'Physical disks' },
  { label: 'showvv', desc: 'Virtual volumes' }, { label: 'showhost', desc: 'Connected hosts' },
  { label: 'showcage', desc: 'Drive cages' }, { label: 'showalert', desc: 'Alerts' },
  { label: 'showversion', desc: 'Firmware version' }, { label: 'shownet', desc: 'Network config' },
]

export default function EmulatorPage({ apiBase }) {
  const API = apiBase || ''
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [commandInput, setCommandInput] = useState('')
  const [history, setHistory] = useState([])
  const [running, setRunning] = useState(false)
  const termBodyRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/api/sim/devices`).then(r => r.json())
      .then(d => { const list = d.devices || d; setDevices(Array.isArray(list) ? list : []) }).catch(() => {})
  }, [API])

  const scrollBottom = () => { if (termBodyRef.current) termBodyRef.current.scrollTop = termBodyRef.current.scrollHeight }
  useEffect(scrollBottom, [history])

  const runCommand = useCallback(async (cmd) => {
    if (!selectedDevice || running) return
    const trimmed = (cmd || commandInput).trim(); if (!trimmed) return
    setCommandInput('')
    setHistory(prev => [...prev, { type: 'cmd', text: `${selectedDevice}# ${trimmed}` }])
    setRunning(true)
    try {
      const res = await fetch(`${API}/api/cli/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: selectedDevice, command: trimmed })
      })
      const data = await res.json()
      if (data.error) setHistory(prev => [...prev, { type: 'error', text: data.error }])
      else {
        const output = data.output || data.raw || JSON.stringify(data, null, 2)
        setHistory(prev => [...prev, { type: 'out', text: output }])
      }
    } catch (err) {
      setHistory(prev => [...prev, { type: 'error', text: `Connection error: ${err.message}` }])
    } finally { setRunning(false) }
  }, [selectedDevice, commandInput, running, API])

  const handleKeyDown = (e) => { if (e.key === 'Enter') runCommand() }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">CLI Emulator</h2>
          <p className="page-subtitle">Execute HPE 3PAR / Primera commands on simulated devices</p>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        {/* Device sidebar */}
        <div className="glass-card" style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={16} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Simulated Devices</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{devices.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {devices.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                No devices found.<br />Start the simulator first.
              </div>
            )}
            {devices.map(d => {
              const name = typeof d === 'string' ? d.replace('.txt', '') : d.name || d
              return (
                <button key={name} onClick={() => { setSelectedDevice(name); setHistory([{ type: 'info', text: `Connected to ${name}` }]) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px',
                    borderRadius: 8, border: selectedDevice === name ? '1px solid var(--hpe-green)' : '1px solid transparent',
                    background: selectedDevice === name ? 'var(--hpe-green-light)' : 'transparent',
                    color: selectedDevice === name ? 'var(--hpe-green)' : 'var(--foreground)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 500, textAlign: 'left', fontFamily: 'var(--font-mono)',
                    transition: 'all 0.15s', marginBottom: 2,
                  }}>
                  <Monitor size={14} /> {name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Terminal */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Quick commands */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COMMANDS.map(c => (
              <button key={c.label} className="btn btn-sm" disabled={!selectedDevice || running}
                onClick={() => runCommand(c.label)} title={c.desc}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {c.label}
              </button>
            ))}
          </div>

          <div className="terminal-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="terminal-header">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8, flex: 1 }}>
                {selectedDevice ? `${selectedDevice} — HPE CLI` : 'Select a device to connect'}
              </span>
              <button className="btn btn-sm" onClick={() => setHistory([])} style={{ padding: '2px 8px' }}>
                <RotateCcw size={12} />Clear
              </button>
            </div>
            <div className="terminal-body" ref={termBodyRef} style={{ flex: 1, maxHeight: 'none' }}>
              {history.length === 0 && (
                <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                  {selectedDevice ? `Ready. Type a command or click a quick command above.` : `← Select a device from the sidebar`}
                </div>
              )}
              {history.map((line, i) => (
                <div key={i} className={`terminal-line ${line.type}`}>{line.text}</div>
              ))}
              {running && <div className="terminal-line info" style={{ opacity: 0.6 }}>Executing...</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--line)', padding: '8px 12px', gap: 8 }}>
              <span className="terminal-prompt">{selectedDevice ? `${selectedDevice}#` : '$'}</span>
              <input style={{
                flex: 1, background: 'transparent', border: 'none', color: '#c9d1d9',
                fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none'
              }}
                value={commandInput} onChange={e => setCommandInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder={selectedDevice ? 'Enter command...' : 'Select a device first'}
                disabled={!selectedDevice || running} autoFocus />
              <button className="btn btn-primary btn-sm" onClick={() => runCommand()} disabled={!selectedDevice || running || !commandInput.trim()}>
                <Play size={12} />Run
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
