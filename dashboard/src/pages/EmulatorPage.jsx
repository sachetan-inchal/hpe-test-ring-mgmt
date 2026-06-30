import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, RotateCcw, Server, Bot } from 'lucide-react'

const ARRAY_CMDS = [
  { label: 'showsys', desc: 'System overview' },
  { label: 'shownode', desc: 'Node details' },
  { label: 'showport', desc: 'Port info' },
  { label: 'showpd', desc: 'Physical disks' },
  { label: 'showhost', desc: 'Connected hosts' },
  { label: 'showcage', desc: 'Drive cages' },
  { label: 'showportdev ns -nohdtot 0:3:1', desc: 'Port device NS (port 0:3:1)' },
  { label: 'showversion -b', desc: 'Firmware version' },
]

const SWITCH_CMDS = [
  { label: 'fabricshow', desc: 'FC fabric topology' },
  { label: 'switchshow', desc: 'Switch state + port table' },
  { label: 'help', desc: 'Available commands' },
]

const HOST_LINUX_CMDS = [
  { label: 'uname -a', desc: 'OS info' },
  { label: 'hostname', desc: 'Hostname' },
  { label: 'ip addr show', desc: 'Network interfaces' },
  { label: 'multipath -ll', desc: 'Multipath status' },
  { label: "systool -c fc_host -v | grep -E 'Class Device|port_state|port_name|speed'", desc: 'HBA FC info' },
  { label: "lspci -nnk | grep -A3 -i 'fibre|fc|emulex|qlogic|lpfc|qlgc'", desc: 'PCI FC adapters' },
]

const HOST_WIN_CMDS = [
  { label: 'Get-PhysicalDisk | Select-Object DeviceId, Model, FirmwareVersion', desc: 'Physical disks' },
  { label: 'Get-ComputerInfo', desc: 'OS & hardware' },
  { label: 'Get-HBaPort', desc: 'FC HBA ports' },
]

function getDeviceCmds(device) {
  if (!device) return []
  const t = (device?.type || '').toLowerCase()
  const os = (device?.os || device?.os_name || '').toLowerCase()
  if (t === 'switch') return SWITCH_CMDS
  if (t === 'array' || t === 'arraysystem') return ARRAY_CMDS
  if (os.includes('windows')) return HOST_WIN_CMDS
  return HOST_LINUX_CMDS
}

function getSSHUserForDevice(device) {
  const t = (device?.type || '').toLowerCase()
  return t === 'switch' ? 'admin' : 'root'
}

function getDeviceKind(device) {
  if (!device) return 'host_linux'
  const t = (device?.type || '').toLowerCase()
  const os = (device?.os || device?.os_name || '').toLowerCase()
  if (t === 'switch') return 'switch'
  if (t === 'array' || t === 'arraysystem') return 'array'
  if (os.includes('windows')) return 'host_windows'
  return 'host_linux'
}

const COL = {
  cmd: '#3fb950',
  out: '#c9d1d9',
  error: '#f85149',
  info: '#58a6ff',
  warn: '#e3b341',
  ssh: '#d2a8ff',
}

export default function EmulatorPage({ apiBase, deviceFilter }) {
  const navigate = useNavigate()
  const API = apiBase || ''
  const filterType = deviceFilter || 'virtual'
  const [virtualDevices, setVirtualDevices] = useState([])
  const [realDevices, setRealDevices] = useState([])

  // Terminal states: 'disconnected' | 'ssh_init' | 'awaiting_yes_no' | 'awaiting_password' | 'connected'
  const [sshState, setSshState] = useState('disconnected')
  const [activeDevice, setActiveDevice] = useState(null)
  const [handshake, setHandshake] = useState(null)
  const [prompt, setPrompt] = useState('console-gateway$ ')

  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const [cmdHistory, setCmdHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)

  const termBodyRef = useRef(null)
  const inputRef = useRef(null)

  // ── Fetch Devices ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Fetch virtual devices
    fetch(`${API}/api/sim/devices`).then(r => r.json())
      .then(d => {
        const list = d.devices || d
        setVirtualDevices(Array.isArray(list) ? list : [])
      }).catch(() => { })

    // Fetch real devices
    fetch(`${API}/api/credentials/list`).then(r => r.json())
      .then(d => {
        const list = d.devices || []
        const real = list.filter(dev => dev.device_kind === 'real')
        setRealDevices(real)
      }).catch(() => { })
  }, [API])

  // Initialize terminal banner
  useEffect(() => {
    setHistory([
      { type: 'info', text: 'HPE SAN Console Gateway v2.0.0 (Jump-Host Server)' },
      { type: 'info', text: '-------------------------------------------------' },
      { type: 'info', text: 'Type "ssh <user>@<ip>" to establish a secure CLI session to any virtual or real device.' },
      { type: 'info', text: 'Example: ssh root@10.20.10.5' },
      { type: 'info', text: 'Or click a device on the sidebar list to connect automatically.' },
      { type: 'out', text: '' },
    ])
  }, [])

  const scrollBottom = () => {
    if (termBodyRef.current) {
      termBodyRef.current.scrollTop = termBodyRef.current.scrollHeight
    }
  }
  useEffect(scrollBottom, [history, input, prompt])

  const focusInput = () => {
    inputRef.current?.focus()
  }

  useEffect(() => {
    focusInput()
  }, [sshState])

  const addLine = useCallback((type, text) =>
    setHistory(prev => [...prev, { type, text }]), [])

  // ── Sidebar Click Shortcut ─────────────────────────────────────────────────
  const handleSidebarClick = async (device) => {
    try {
      const user = device.username || getSSHUserForDevice(device)
      const ip = device.ip || device.ip_address

      if (sshState === 'connected' && (activeDevice?.ip === ip || activeDevice?.ip_address === ip)) {
        addLine('info', `Already connected to ${device.name || device.device_name || ip}`)
        return
      }

      let histText = `ssh ${user}@${ip}`
      if (sshState === 'connected') {
        addLine('info', `Connection to ${activeDevice?.name || activeDevice?.device_name || activeDevice?.ip || activeDevice?.ip_address} closed.`)
      }

      setSshState('disconnected')
      setInput('')
      await startSSHHandshake(user, ip, histText, device)
    } catch (err) {
      addLine('error', `Sidebar redirect error: ${err.message}`)
    }
  }

  // ── Start SSH Connection Handshake ─────────────────────────────────────────
  const startSSHHandshake = async (user, ip, originalCmd, deviceObj = null) => {
    addLine('cmd', `${sshState === 'connected' ? prompt : 'console-gateway$ '}${originalCmd}`)
    setLoading(true)

    const foundDev = deviceObj ||
      virtualDevices.find(d => d.ip === ip || d.ip_address === ip) ||
      realDevices.find(d => d.ip === ip || d.ip_address === ip)

    if (!foundDev) {
      addLine('error', `ssh: Could not resolve hostname ${ip}: Name or service not known`)
      setPrompt('console-gateway$ ')
      setSshState('disconnected')
      setLoading(false)
      return
    }

    // If it's a real device, establish connection immediately with stored credentials
    if (foundDev.device_kind === 'real' || filterType === 'real') {
      try {
        const devName = foundDev.device_name || foundDev.name || ip
        const loginUser = foundDev.username || user || 'root'
        addLine('info', `Establishing secure SSH connection to ${devName} (${ip})...`)
        setActiveDevice(foundDev)

        const devKind = (foundDev.category || foundDev.type || '').toLowerCase()
        if (devKind === 'switch') {
          addLine('out', `${devName}:FID100:admin> `)
          setPrompt(`${devName}:FID100:admin> `)
        } else if (devKind === 'array' || devKind === 'arraysystem') {
          addLine('out', `root@${devName}:~# `)
          setPrompt(`root@${devName}:~# `)
        } else {
          addLine('info', `Linux ${devName} — logged in as ${loginUser}`)
          addLine('out', '')
          setPrompt(`root@${devName}:~$ `)
        }
        setSshState('connected')
      } catch (err) {
        addLine('error', `SSH Connection failed: ${err.message}`)
        setPrompt('console-gateway$ ')
        setSshState('disconnected')
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      const res = await fetch(`${API}/api/sim/ssh/connect/${ip}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setHandshake(data)
      setActiveDevice(foundDev)

      if (data.key_type) {
        addLine('warn', `Warning: the ${data.key_type} host key for '${data.name || ip}' differs from the key for the IP address '${ip}'`)
        setPrompt('Are you sure you want to continue connecting (yes/no)? ')
        setSshState('awaiting_yes_no')
      } else {
        setPrompt(data.password_prompt || 'Password: ')
        setSshState('awaiting_password')
      }
    } catch (err) {
      addLine('error', `Bypassing SSH simulation: Connection failed directly: ${err.message}`)
      setPrompt(`${foundDev?.name || ip}# `)
      setActiveDevice(foundDev)
      setSshState('connected')
    } finally {
      setLoading(false)
    }
  }

  // ── Key Press & Key Down Handler ───────────────────────────────────────────
  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = input.trim()
      const currentVal = input
      setInput('')

      if (trimmed === 'clear') {
        setHistory([])
        return
      }

      try {
        // ── State: Disconnected ──
        if (sshState === 'disconnected') {
          if (!trimmed) {
            addLine('cmd', prompt)
            return
          }

          if (trimmed.startsWith('ssh ')) {
            const parts = trimmed.substring(4).split('@')
            let user = 'root'
            let ip = ''
            if (parts.length === 2) {
              user = parts[0]
              ip = parts[1]
            } else {
              ip = parts[0]
            }
            await startSSHHandshake(user, ip, trimmed)
          } else {
            addLine('cmd', `${prompt}${trimmed}`)
            addLine('error', 'Error: Not connected. Establish secure CLI session using "ssh <user>@<ip>" or select a device from the sidebar.')
            addLine('out', '')
          }
          return
        }

        // ── State: Awaiting Yes/No ──
        if (sshState === 'awaiting_yes_no') {
          addLine('cmd', `${prompt}${currentVal}`)
          if (trimmed.toLowerCase() === 'yes') {
            const nextPrompt = handshake?.password_prompt || 'Password: '
            setPrompt(nextPrompt)
            setSshState('awaiting_password')
          } else if (trimmed.toLowerCase() === 'no') {
            addLine('error', 'Host key verification failed. Connection closed.')
            setPrompt('console-gateway$ ')
            setSshState('disconnected')
            setActiveDevice(null)
          } else {
            addLine('error', "Please type 'yes' or 'no'.")
          }
          return
        }

        // ── State: Awaiting Password ──
        if (sshState === 'awaiting_password') {
          // Linux/Brocade switch hides password completely. Append prompt prefix only.
          addLine('cmd', `${prompt}`)

          const devName = handshake?.name || activeDevice?.name || activeDevice?.ip || 'device'
          const loginUser = handshake?.login_user || 'root'
          const devKind = getDeviceKind(activeDevice)

          if (devKind === 'switch') {
            addLine('out', `${devName}:FID100:admin> `)
            setPrompt(`${devName}:FID100:admin> `)
          } else if (devKind === 'array') {
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

        // ── State: Connected (CLI Execution) ──
        if (sshState === 'connected') {
          if (!trimmed) {
            addLine('cmd', prompt)
            return
          }

          addLine('cmd', `${prompt}${trimmed}`)

          if (trimmed === 'exit' || trimmed === 'logout') {
            addLine('info', `Connection to ${activeDevice?.name || activeDevice?.device_name || activeDevice?.ip || activeDevice?.ip_address} closed.`)
            addLine('out', '')
            setPrompt('console-gateway$ ')
            setSshState('disconnected')
            setActiveDevice(null)
            return
          }

          setCmdHistory(prev => [trimmed, ...prev.slice(0, 49)])
          setHistIdx(-1)
          setLoading(true)

          try {
            const isReal = activeDevice?.device_kind === 'real'
            const endpoint = isReal ? `${API}/api/ssh/exec` : `${API}/api/sim/exec`
            const body = isReal ? {
              ip: activeDevice.ip || activeDevice.ip_address,
              username: activeDevice.username,
              password: activeDevice.password,
              port: activeDevice.port || 22,
              command: trimmed
            } : {
              ip: activeDevice?.ip || activeDevice?.ip_address,
              command: trimmed
            }

            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            })
            const data = await res.json()
            const output = data.output || data.error || 'No output'
            output.split('\n').forEach(line => addLine('out', line))
            addLine('out', '')
          } catch (err) {
            addLine('error', `Connection error: ${err.message}`)
          } finally {
            setLoading(false)
          }
        }
      } catch (err) {
        addLine('error', `Internal console error: ${err.stack || err.message}`)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (sshState !== 'connected') return
      const newIdx = Math.min(histIdx + 1, cmdHistory.length - 1)
      setHistIdx(newIdx)
      setInput(cmdHistory[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (sshState !== 'connected') return
      const newIdx = Math.max(histIdx - 1, -1)
      setHistIdx(newIdx)
      setInput(newIdx === -1 ? '' : cmdHistory[newIdx] || '')
    }
  }

  // ── Quick Pills Trigger ──
  const runQuickCommand = async (cmd) => {
    if (sshState !== 'connected' || loading) return
    addLine('cmd', `${prompt}${cmd}`)
    setLoading(true)
    try {
      const isReal = activeDevice?.device_kind === 'real'
      const endpoint = isReal ? `${API}/api/ssh/exec` : `${API}/api/sim/exec`
      const body = isReal ? {
        ip: activeDevice.ip || activeDevice.ip_address,
        username: activeDevice.username,
        password: activeDevice.password,
        port: activeDevice.port || 22,
        command: cmd
      } : {
        ip: activeDevice?.ip || activeDevice?.ip_address,
        command: cmd
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      const output = data.output || data.error || 'No output'
      output.split('\n').forEach(line => addLine('out', line))
      addLine('out', '')
    } catch (err) {
      addLine('error', `Connection error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      <style dangerouslySetInnerHTML={{
        __html: `
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

      <div className="page-header">
        <div>
          <h2 className="page-title">HPE SAN Interactive Gateway Console</h2>
          <p className="page-subtitle">Connect to your devices via SSH</p>
        </div>
        {sshState === 'connected' && activeDevice && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              sessionStorage.setItem('agent_array_hint', activeDevice.name || activeDevice.ip)
              navigate('/chat')
            }}
            title="Open AI Assistant with this array as target"
          >
            <Bot size={14} /> Ask AI about {activeDevice.name || activeDevice.ip}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        {/* Device sidebar list */}
        <div className="glass-card" style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>


          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={16} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              {filterType === 'virtual' ? 'Available Host IPs' : 'Available IPs'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 10 }}>
              {filterType === 'virtual' ? virtualDevices.length : realDevices.length}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            {filterType === 'virtual' && virtualDevices.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                No active virtual devices found. Ensure simulation is running.
              </div>
            )}
            {filterType === 'real' && realDevices.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                No registered real devices found. Configure them in the Inventory tab.
              </div>
            )}
            {(filterType === 'virtual' ? virtualDevices : realDevices).map(d => {
              const name = d.name || d.device_name || d.ip || d.ip_address
              const ip = d.ip || d.ip_address
              const isCurrent = activeDevice?.ip === ip || activeDevice?.ip_address === ip
              const category = d.type || d.category || 'host'
              const user = d.username || getSSHUserForDevice(d)
              return (
                <button
                  key={name + '-' + ip}
                  onClick={() => handleSidebarClick(d)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: isCurrent ? '1px solid var(--hpe-green)' : '1px solid var(--line)',
                    background: isCurrent ? 'var(--hpe-green-light)' : 'rgba(255,255,255,0.02)',
                    color: isCurrent ? 'var(--hpe-green)' : 'var(--foreground)',
                    cursor: 'pointer',
                    fontSize: 12,
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                    marginBottom: 8,
                  }}
                  onMouseEnter={e => {
                    if (!isCurrent) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                  }}
                  onMouseLeave={e => {
                    if (!isCurrent) e.currentTarget.style.borderColor = 'var(--line)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, width: '100%' }}>
                    <Monitor size={13} style={{ color: isCurrent ? 'var(--hpe-green)' : 'var(--muted)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
                    <span style={{ fontSize: 9, opacity: 0.8, textTransform: 'uppercase' }}>{category}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: isCurrent ? 'var(--hpe-green)' : 'var(--muted)', marginTop: 4, opacity: 0.9 }}>
                    ssh {user}@{ip}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Terminal area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Quick Command Pills for connected device */}
          {sshState === 'connected' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {getDeviceCmds(activeDevice).map(c => (
                <button
                  key={c.label}
                  className="btn btn-sm"
                  disabled={loading}
                  onClick={() => runQuickCommand(c.label)}
                  title={c.desc}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    borderColor: 'var(--hpe-green)',
                    color: '#e6edf3'
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {/* Core Interactive Terminal Console */}
          <div className="terminal-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
            <div className="terminal-header" style={{ background: '#161b22', borderBottom: '1px solid var(--line)' }}>
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8, flex: 1, fontWeight: 500 }}>
                {sshState === 'connected'
                  ? `Active SSH Connection: ${activeDevice?.name || activeDevice?.ip}`
                  : 'Universal CLI Jump Console'}
              </span>
              <button
                className="btn btn-sm"
                onClick={() => setHistory([])}
                style={{ padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <RotateCcw size={11} />Clear Output
              </button>
            </div>

            <div
              className="terminal-body"
              ref={termBodyRef}
              style={{
                flex: 1,
                maxHeight: 'none',
                padding: '16px 18px',
                fontSize: 13,
                lineHeight: 1.8,
                overflowY: 'auto',
                cursor: 'text',
                position: 'relative'
              }}
              onClick={focusInput}
            >
              {/* Output History */}
              {history.map((line, i) => (
                <div key={i} style={{ color: COL[line.type] || '#c8d6d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {line.text}
                </div>
              ))}

              {/* Active Terminal Typing Line */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', color: '#e6edf3' }}>
                <span style={{ color: sshState === 'connected' ? '#39c5cf' : '#e3b341', marginRight: 8, whiteSpace: 'pre' }}>
                  {prompt}
                </span>
                <span style={{ color: '#e6edf3', whiteSpace: 'pre' }}>
                  {sshState === 'awaiting_password' ? '' : input}
                </span>
                <span className="term-cursor" />
              </div>

              {loading && (
                <div style={{ color: '#58a6ff', fontSize: 11, marginTop: 6 }}>
                  <span className="pulse-dot blue" style={{ marginRight: 6 }} />executing…
                </div>
              )}

              {/* Hidden text input captures and maps keys directly onto layout */}
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                style={{
                  position: 'absolute',
                  left: '-9999px',
                  top: '-9999px',
                  width: '1px',
                  height: '1px',
                  opacity: 0,
                  overflow: 'hidden',
                  border: 'none',
                  outline: 'none'
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
