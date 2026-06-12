import { useEffect, useState } from 'react'

export default function SSHRingPage({ apiBase }) {
  const API = apiBase || ''
  
  // Credentials List
  const [devices, setDevices] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(false)

  // Preset commands classified by device category
  const PRESET_COMMANDS = {
    Array: [
      "showversion -b",
      "showsys",
      "shownode",
      "showport",
      "showhost",
      "showcage -pci",
      "showcage -sfp",
      "showcage -state",
      "showpd",
      "showpd -s",
      "showpd -i",
      "showportdev",
      "showportdev ns -nohdtot 0:3:1",
      "showportdev ns -nohdtot 1:3:1"
    ],
    Host: [
      "lscpu",
      "systool -c fc_host -v",
      "lspci -nnk"
    ],
    Switch: [
      "fabricshow",
      "switchshow"
    ]
  }

  // Add/Edit Form State
  const [deviceName, setDeviceName] = useState('')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [dnsName, setDnsName] = useState('')
  const [dnsServer, setDnsServer] = useState('')
  const [category, setCategory] = useState('Host')
  const [isEditing, setIsEditing] = useState(false)
  const [originalDeviceName, setOriginalDeviceName] = useState('')
  const [saveStatus, setSaveStatus] = useState({ text: '', type: '' })

  // Run Form State
  const [targetIp, setTargetIp] = useState('')
  const [targetUser, setTargetUser] = useState('')
  const [targetPort, setTargetPort] = useState('22')
  const [targetPassword, setTargetPassword] = useState('')
  const [targetDnsName, setTargetDnsName] = useState('')
  const [targetDnsServer, setTargetDnsServer] = useState('')
  const [targetCategory, setTargetCategory] = useState('Host')
  const [selectedPresets, setSelectedPresets] = useState([])
  const [command, setCommand] = useState('ls')
  const [runStatus, setRunStatus] = useState({ text: '', type: '' })
  const [cmdOutput, setCmdOutput] = useState('(No output yet)')
  const [isExecuting, setIsExecuting] = useState(false)

  // Auto-select all preset commands when target device category changes
  useEffect(() => {
    if (targetCategory && PRESET_COMMANDS[targetCategory]) {
      setSelectedPresets(PRESET_COMMANDS[targetCategory])
    } else {
      setSelectedPresets([])
    }
  }, [targetCategory])

  // Fetch devices on mount and when API changes
  const fetchDevices = async () => {
    setLoadingDevices(true)
    try {
      const res = await fetch(`${API}/api/credentials/list`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      setDevices(data?.devices || [])
    } catch (e) {
      console.error('Failed to fetch devices:', e)
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    if (API) {
      fetchDevices()
    }
  }, [API])

  // Handle Save
  const handleSave = async (e) => {
    e.preventDefault()
    if (!deviceName.trim() || (!ip.trim() && !dnsName.trim()) || !username.trim() || !password) {
      setSaveStatus({ text: 'Device name, IP or DNS Name, username, and password are required', type: 'err' })
      return
    }

    setSaveStatus({ text: 'Saving credentials...', type: 'ok' })
    try {
      const res = await fetch(`${API}/api/credentials/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_name: deviceName.trim(),
          ip: ip.trim(),
          port: parseInt(port || '22', 10),
          username: username.trim(),
          password: password,
          dns_name: dnsName.trim(),
          dns_server: dnsServer.trim(),
          category: category
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)

      // If we were editing a device and renamed it, delete the original name from database
      if (isEditing && originalDeviceName && originalDeviceName !== deviceName.trim()) {
        await fetch(`${API}/api/credentials/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_name: originalDeviceName }),
        })
      }

      setSaveStatus({ text: `Saved "${deviceName.trim()}" successfully`, type: 'ok' })
      
      // Clear form
      setDeviceName('')
      setIp('')
      setPort('22')
      setUsername('')
      setPassword('')
      setDnsName('')
      setDnsServer('')
      setCategory('Host')
      setIsEditing(false)
      setOriginalDeviceName('')
      
      await fetchDevices()
    } catch (err) {
      setSaveStatus({ text: `Save failed: ${err.message}`, type: 'err' })
    }
  }

  // Handle Delete
  const handleDelete = async (device) => {
    if (!window.confirm(`Delete SSH credentials for "${device.device_name}"?`)) return
    try {
      const res = await fetch(`${API}/api/credentials/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: device.device_name, ip: device.ip_address }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaveStatus({ text: `Deleted "${device.device_name}"`, type: 'ok' })
      await fetchDevices()
    } catch (e) {
      setSaveStatus({ text: `Delete failed: ${e.message}`, type: 'err' })
    }
  }

  // Handle Edit Action
  const handleEdit = (device) => {
    setDeviceName(device.device_name || '')
    setIp(device.ip_address || device.ip || '')
    setPort(String(device.port ?? 22))
    setUsername(device.username || '')
    setPassword(device.password || '')
    setDnsName(device.dns_name || '')
    setDnsServer(device.dns_server || '')
    setCategory(device.category || 'Host')
    setIsEditing(true)
    setOriginalDeviceName(device.device_name || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle Use Action
  const handleUse = (device) => {
    setTargetIp(device.ip_address || device.ip || '')
    setTargetUser(device.username || '')
    setTargetPort(String(device.port ?? 22))
    setTargetPassword(device.password || '')
    setTargetDnsName(device.dns_name || '')
    setTargetDnsServer(device.dns_server || '')
    setTargetCategory(device.category || 'Host')
  }

  // Connect & Run Command
  const handleRun = async (e, customCmd = null) => {
    if (e) e.preventDefault()
    const cmdToRun = customCmd || command
    if ((!targetIp.trim() && !targetDnsName.trim()) || !targetUser.trim() || !targetPassword) {
      setRunStatus({ text: 'Enter target IP or DNS Name, username, and password first', type: 'err' })
      return
    }

    setRunStatus({ text: 'Connecting & executing command...', type: 'ok' })
    setCmdOutput('(Connecting...)')
    setIsExecuting(true)

    try {
      const res = await fetch(`${API}/api/ssh/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: targetIp.trim(),
          username: targetUser.trim(),
          password: targetPassword,
          port: parseInt(targetPort || '22', 10),
          command: cmdToRun,
          dns_name: targetDnsName.trim(),
          dns_server: targetDnsServer.trim()
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)

      let output = ''
      if (data.results) {
        for (const [cmd, result] of Object.entries(data.results)) {
          output += `$ ${cmd}\n`
          if (result.stdout) output += result.stdout + '\n'
          if (result.stderr) output += `[ERROR] ${result.stderr}\n`
          output += '\n'
        }
      } else {
        output = data.output || JSON.stringify(data, null, 2)
      }

      setCmdOutput(output || '(no output)')
      setRunStatus({ text: 'Execution complete', type: 'ok' })
    } catch (err) {
      setCmdOutput(`ERROR: ${err.message}`)
      setRunStatus({ text: 'Execution failed', type: 'err' })
    } finally {
      setIsExecuting(false)
    }
  }

  // Quick Command Run using selected presets
  const handleQuickRun = () => {
    if (selectedPresets.length === 0) {
      setRunStatus({ text: 'No preset commands checked', type: 'err' })
      return
    }
    const composite = selectedPresets
      .map(cmd => `echo "--- CMD: ${cmd} ---"; ${cmd}`)
      .join('; ')
    setCommand(composite)
    handleRun(null, composite)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 20, padding: 12 }}>
      <div>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 800, color: 'var(--hpe-green)' }}>
          SSH Ring Manager
        </h1>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: '13px', lineHeight: 1.4 }}>
          Securely register network credentials and run interactive diagnostic commands on registered storage nodes.
        </p>
      </div>

      {/* Grid for forms */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 20
      }}>
        {/* Form: Add / Save credentials */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
            {isEditing ? `Edit "${originalDeviceName}"` : 'Add / Save SSH Credentials'}
          </h2>
          
          <div className="note" style={{
            fontSize: '11px',
            color: 'var(--muted)',
            padding: 10,
            borderRadius: 8,
            border: '1px dashed rgba(1, 169, 130, 0.3)',
            background: 'rgba(255, 255, 255, 0.02)'
          }}>
            Credentials are securely indexed and encrypted in the Mongo database. Plaintext passwords are not cached.
          </div>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Device Name</label>
              <input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g. node-alpha"
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(1, 169, 130, 0.3)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: 'var(--foreground)',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>IP Address</label>
                <input
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="e.g. 192.168.1.101"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Name</label>
                <input
                  value={dnsName}
                  onChange={(e) => setDnsName(e.target.value)}
                  placeholder="e.g. c3-dl380g11-25"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Server IP</label>
                <input
                  value={dnsServer}
                  onChange={(e) => setDnsServer(e.target.value)}
                  placeholder="e.g. 8.8.8.8"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Port</label>
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="22"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(0, 0, 0, 0.2)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                >
                  <option value="Host" style={{ background: '#1a1a1a', color: '#fff' }}>Host</option>
                  <option value="Array" style={{ background: '#1a1a1a', color: '#fff' }}>Array</option>
                  <option value="Switch" style={{ background: '#1a1a1a', color: '#fff' }}>Switch</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. root"
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="SSH password"
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="submit"
                style={{
                  flex: 2,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--hpe-green)',
                  background: 'rgba(1, 169, 130, 0.15)',
                  color: 'var(--hpe-green)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                {isEditing ? 'Update Credentials' : 'Save Credentials'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false)
                    setDeviceName('')
                    setIp('')
                    setPort('22')
                    setUsername('')
                    setPassword('')
                    setOriginalDeviceName('')
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'var(--muted)',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {saveStatus.text && (
            <div style={{
              fontSize: '13px',
              marginTop: 4,
              color: saveStatus.type === 'ok' ? 'var(--hpe-green)' : '#ff6b6b'
            }}>
              {saveStatus.text}
            </div>
          )}
        </div>

        {/* Form: Run commands against saved credentials */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
            Run Diagnostic Commands
          </h2>

          <form onSubmit={handleRun} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Target IP</label>
                <input
                  value={targetIp}
                  onChange={(e) => setTargetIp(e.target.value)}
                  placeholder="e.g. 192.168.1.101"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Name</label>
                <input
                  value={targetDnsName}
                  onChange={(e) => setTargetDnsName(e.target.value)}
                  placeholder="c3-dl380g11-25"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Server</label>
                <input
                  value={targetDnsServer}
                  onChange={(e) => setTargetDnsServer(e.target.value)}
                  placeholder="8.8.8.8"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Port</label>
                <input
                  value={targetPort}
                  onChange={(e) => setTargetPort(e.target.value)}
                  placeholder="22"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Target Category</label>
                <select
                  value={targetCategory}
                  onChange={(e) => setTargetCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(0, 0, 0, 0.2)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                >
                  <option value="Host" style={{ background: '#1a1a1a', color: '#fff' }}>Host</option>
                  <option value="Array" style={{ background: '#1a1a1a', color: '#fff' }}>Array</option>
                  <option value="Switch" style={{ background: '#1a1a1a', color: '#fff' }}>Switch</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Username</label>
                <input
                  value={targetUser}
                  onChange={(e) => setTargetUser(e.target.value)}
                  placeholder="Username"
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Password</label>
                <input
                  type="password"
                  value={targetPassword}
                  onChange={(e) => setTargetPassword(e.target.value)}
                  placeholder="Password"
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 6 }}>
                Preset Commands for {targetCategory} (Check/Uncheck to include)
              </label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '8px',
                padding: '12px',
                borderRadius: 8,
                border: '1px solid rgba(1, 169, 130, 0.2)',
                background: 'rgba(0, 0, 0, 0.25)',
                maxHeight: '160px',
                overflowY: 'auto',
                marginBottom: 10
              }}>
                {PRESET_COMMANDS[targetCategory]?.map((cmd) => {
                  const isChecked = selectedPresets.includes(cmd)
                  return (
                    <label key={cmd} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      color: isChecked ? 'var(--foreground)' : 'var(--muted)',
                      transition: 'color 0.2s'
                    }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPresets(prev => [...prev, cmd])
                          } else {
                            setSelectedPresets(prev => prev.filter(c => c !== cmd))
                          }
                        }}
                        style={{
                          accentColor: 'var(--hpe-green)',
                          cursor: 'pointer'
                        }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{cmd}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Command to run</label>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. ls"
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(1, 169, 130, 0.3)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="submit"
                disabled={isExecuting}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--hpe-green)',
                  background: 'rgba(1, 169, 130, 0.15)',
                  color: 'var(--hpe-green)',
                  fontWeight: 700,
                  cursor: isExecuting ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                {isExecuting ? 'Running...' : 'Connect & Run'}
              </button>
              <button
                type="button"
                onClick={handleQuickRun}
                disabled={isExecuting}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--foreground)',
                  fontWeight: 600,
                  cursor: isExecuting ? 'not-allowed' : 'pointer'
                }}
              >
                Quick Run Info
              </button>
            </div>
          </form>

          {runStatus.text && (
            <div style={{
              fontSize: '13px',
              color: runStatus.type === 'ok' ? 'var(--hpe-green)' : '#ff6b6b'
            }}>
              {runStatus.text}
            </div>
          )}
        </div>
      </div>

      {/* Embedded Terminal Output console */}
      <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, color: 'var(--hpe-green)' }}>
          Command Output Console
        </div>
        <pre style={{
          margin: 0,
          padding: 14,
          maxHeight: 280,
          overflow: 'auto',
          color: '#eaf1ff',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(1, 169, 130, 0.25)',
          borderRadius: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap'
        }}>
          {cmdOutput}
        </pre>
      </div>

      {/* Saved Devices Table */}
      <div className="glass-card" style={{ padding: 20 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
          Devices from Server
        </h2>
        
        {loadingDevices ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '10px 0' }}>Loading device index...</div>
        ) : devices.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '10px 0' }}>No registered SSH devices. Create one above to get started.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Device Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Category</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>IP Address</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>DNS Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>DNS Server</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Username</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Port</th>
                  <th style={{ textAlign: 'right', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', transition: 'background 0.2s' }}>
                     <td style={{ padding: '12px 8px', fontSize: '13px', fontWeight: 600 }}>{device.device_name}</td>
                     <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                       <span style={{
                         padding: '2px 6px',
                         borderRadius: 4,
                         fontSize: '11px',
                         fontWeight: 'bold',
                         background: device.category === 'Array' ? 'rgba(0, 200, 255, 0.15)' : device.category === 'Switch' ? 'rgba(255, 170, 0, 0.15)' : 'rgba(128, 128, 128, 0.15)',
                         color: device.category === 'Array' ? '#00c8ff' : device.category === 'Switch' ? '#ffaa00' : 'var(--muted)',
                         border: `1px solid ${device.category === 'Array' ? 'rgba(0, 200, 255, 0.3)' : device.category === 'Switch' ? 'rgba(255, 170, 0, 0.3)' : 'rgba(128, 128, 128, 0.3)'}`
                       }}>
                         {device.category || 'Host'}
                       </span>
                     </td>
                     <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.ip_address || '-'}</td>
                     <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.dns_name || '-'}</td>
                     <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.dns_server || '-'}</td>
                     <td style={{ padding: '12px 8px', fontSize: '13px' }}>{device.username}</td>
                     <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.port}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleUse(device)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '11px',
                            border: '1px solid var(--hpe-green)',
                            background: 'rgba(1, 169, 130, 0.08)',
                            color: 'var(--hpe-green)',
                            cursor: 'pointer'
                          }}
                        >
                          Use
                        </button>
                        <button
                          onClick={() => handleEdit(device)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '11px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: 'var(--foreground)',
                            cursor: 'pointer'
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(device)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '11px',
                            border: '1px solid rgba(255, 107, 107, 0.3)',
                            background: 'rgba(255, 107, 107, 0.08)',
                            color: '#ff6b6b',
                            cursor: 'pointer'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
