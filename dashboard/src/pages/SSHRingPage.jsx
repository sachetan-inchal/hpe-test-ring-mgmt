import { useEffect, useState, useContext, useRef } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { AuthContext } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function SSHRingPage({ apiBase }) {
  const { user } = useContext(AuthContext)
  const navigate = useNavigate()
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
      "showswitch",
      "showcage -pci",
      "showcage -sfp",
      "showcage -state",
      "showcage",
      "showpd",
      "showpd -s",
      "showpd -i",
      "showportdev"
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

  // Virtual / Mock Device additions
  const [deviceKind, setDeviceKind] = useState('real') // 'real' or 'mock'
  const [vsanDeviceType, setVsanDeviceType] = useState('host') // 'host', 'array', 'switch', 'custom'
  const [selectedCommands, setSelectedCommands] = useState([])
  const [customCommands, setCustomCommands] = useState([])
  const [newCustomCommand, setNewCustomCommand] = useState('')
  const [mockCommands, setMockCommands] = useState({}) // cmd -> { stdout, stderr, exit_code }

  // Mock Output Editor State
  const [selectedMockCmd, setSelectedMockCmd] = useState('')
  const [mockStdout, setMockStdout] = useState('')
  const [mockStderr, setMockStderr] = useState('')
  const [mockExitCode, setMockExitCode] = useState(0)

  const [isEditing, setIsEditing] = useState(false)
  const [originalDeviceName, setOriginalDeviceName] = useState('')
  const [saveStatus, setSaveStatus] = useState({ text: '', type: '' })
  
  // Team Scoping for Device Registration
  const [deviceTeam, setDeviceTeam] = useState('')
  const [availableTeams, setAvailableTeams] = useState([])
  const [oobIp, setOobIp] = useState('')
  const [connectedTo, setConnectedTo] = useState('')
  const [targetInbandIp, setTargetInbandIp] = useState('')

  // Run Form State
  const [targetIp, setTargetIp] = useState('')
  const [targetOobIp, setTargetOobIp] = useState('')
  const [useOobIp, setUseOobIp] = useState(false)
  const [targetUser, setTargetUser] = useState('')
  const [targetPort, setTargetPort] = useState('22')
  const [targetPassword, setTargetPassword] = useState('')
  const [targetDnsName, setTargetDnsName] = useState('')
  const [targetDnsServer, setTargetDnsServer] = useState('')
  const [targetCategory, setTargetCategory] = useState('Host')
  const [selectedPresets, setSelectedPresets] = useState([])
  const [targetCustomCommands, setTargetCustomCommands] = useState([])
  const [selectedCustomPresets, setSelectedCustomPresets] = useState([])
  const [command, setCommand] = useState('ls')
  const [runStatus, setRunStatus] = useState({ text: '', type: '' })
  const [cmdOutput, setCmdOutput] = useState('(No output yet)')
  const [isExecuting, setIsExecuting] = useState(false)

  // Discovery State
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoverStatus, setDiscoverStatus] = useState('')
  const [discoveryResults, setDiscoveryResults] = useState(null)
  const [discoveryProgress, setDiscoveryProgress] = useState(0)
  const [discoveryTotal, setDiscoveryTotal] = useState(0)
  const discoveryCancelRef = useRef(false)

  const handleCancelDiscovery = () => {
    discoveryCancelRef.current = true
    setDiscoverStatus('Cancelling discovery...')
  }

  // Selection of devices in the table
  const [selectedDeviceIps, setSelectedDeviceIps] = useState(new Set())

  // Auto-select all preset commands when target device category changes
  useEffect(() => {
    if (targetCategory && PRESET_COMMANDS[targetCategory]) {
      setSelectedPresets(PRESET_COMMANDS[targetCategory])
    } else {
      setSelectedPresets([])
    }
  }, [targetCategory])

  // Sync category when vsanDeviceType changes
  useEffect(() => {
    if (deviceKind === 'mock') {
      if (vsanDeviceType === 'array') setCategory('Array')
      else if (vsanDeviceType === 'switch') setCategory('Switch')
      else if (vsanDeviceType === 'host') setCategory('Host')
    }
  }, [vsanDeviceType, deviceKind])

  // Fetch devices on mount and when API changes
  const fetchDevices = async () => {
    setLoadingDevices(true)
    try {
      const res = await fetch(`${API}/api/credentials/list`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      const rawDevices = (data?.devices || []).filter(d => d.device_kind === 'real')
      setDevices(rawDevices)
      // Reset selection when list reloads
      setSelectedDeviceIps(new Set())
    } catch (e) {
      console.error('Failed to fetch devices:', e)
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    if (API) {
      fetchDevices()
      fetch(`${API}/api/teams`)
        .then(r => r.json())
        .then(data => {
          if (data.teams && Array.isArray(data.teams)) {
            // Normalize
            const normalized = data.teams.map(t => typeof t === 'string' ? { id: t.toLowerCase().replace(/ /g, '-'), name: t } : t)
            setAvailableTeams(normalized)
            if (normalized.length > 0 && !deviceTeam) {
              setDeviceTeam(normalized[0].name)
            }
          }
        })
        .catch(() => {})
    }
  }, [API])

  // Handle Save
  const handleSave = async (e) => {
    e.preventDefault()
    if (!deviceName.trim() || (!ip.trim() && !dnsName.trim())) {
      setSaveStatus({ text: 'Device name and IP or DNS Name are required', type: 'err' })
      return
    }
    if (deviceKind === 'real' && (!username.trim() || !password)) {
      setSaveStatus({ text: 'Username and password are required for real SSH devices', type: 'err' })
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
          oob_ip: oobIp.trim(),
          port: parseInt(port || '22', 10),
          username: username.trim(),
          password: password,
          dns_name: dnsName.trim(),
          dns_server: dnsServer.trim(),
          category: category,
          device_kind: deviceKind,
          vsan_device_type: vsanDeviceType,
          selected_commands: selectedCommands,
          custom_commands: customCommands,
          mock_commands: mockCommands,
          team: deviceTeam,
          connected_to: connectedTo
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
      setDeviceKind('real')
      setVsanDeviceType('host')
      setSelectedCommands([])
      setCustomCommands([])
      setMockCommands({})
      setSelectedMockCmd('')
      setMockStdout('')
      setMockStderr('')
      setDeviceTeam(availableTeams[0]?.name || '')
      setOobIp('')
      setConnectedTo('')
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
    setDeviceKind(device.device_kind || 'real')
    setVsanDeviceType(device.vsan_device_type || 'host')
    setSelectedCommands(device.selected_commands || [])
    setCustomCommands(device.custom_commands || [])
    setMockCommands(device.mock_commands || {})
    setDeviceTeam(device.team || 'team-alpha')
    setOobIp(device.oob_ip || '')
    setConnectedTo(device.connected_to || '')
    setIsEditing(true)
    setOriginalDeviceName(device.device_name || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle Use Action
  const handleUse = (device) => {
    const primaryIp = device.ip_address || device.ip || ''
    setTargetIp(primaryIp)
    setTargetInbandIp(primaryIp)
    setTargetUser(device.username || '')
    setTargetPort(String(device.port ?? 22))
    setTargetPassword(device.password || '')
    setTargetDnsName(device.dns_name || '')
    setTargetDnsServer(device.dns_server || '')
    setTargetCategory(device.category || 'Host')
    setTargetOobIp(device.oob_ip || '')
    setUseOobIp(false)

    // Load presets
    if (device.selected_commands && device.selected_commands.length > 0) {
      setSelectedPresets(device.selected_commands.filter(c => (PRESET_COMMANDS[device.category] || []).includes(c)))
    }

    // Load custom commands for target checkboxes
    if (device.custom_commands && device.custom_commands.length > 0) {
      setTargetCustomCommands(device.custom_commands)
      setSelectedCustomPresets(device.custom_commands)
    } else {
      setTargetCustomCommands([])
      setSelectedCustomPresets([])
    }
  }

  // Connect & Run Command
  const handleRun = async (e, customCmd = null) => {
    if (e) e.preventDefault()
    const cmdToRun = customCmd || command
    if ((!targetIp.trim() && !targetDnsName.trim())) {
      setRunStatus({ text: 'Enter target IP or DNS Name first', type: 'err' })
      return
    }

    setRunStatus({ text: 'Connecting & executing command...', type: 'ok' })
    setCmdOutput('(Connecting...)')
    setIsExecuting(true)

    const ipToUse = (useOobIp && targetOobIp) ? targetOobIp : targetIp;

    try {
      const res = await fetch(`${API}/api/ssh/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: ipToUse.trim(),
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

  // Quick Command Run using selected presets + custom target presets
  const handleQuickRun = () => {
    const allSelected = [...selectedPresets, ...selectedCustomPresets]
    if (allSelected.length === 0) {
      setRunStatus({ text: 'Select at least one preset or custom command to run', type: 'err' })
      return
    }

    setRunStatus({ text: `Executing batch of ${allSelected.length} commands...`, type: 'ok' })
    setCmdOutput('(Executing batch...)')
    setIsExecuting(true)

    const runBatch = async () => {
      try {
        const res = await fetch(`${API}/api/ssh/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ip: targetIp.trim(),
            username: targetUser.trim(),
            password: targetPassword,
            port: parseInt(targetPort || '22', 10),
            commands: allSelected,
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
        setRunStatus({ text: 'Batch execution complete', type: 'ok' })
      } catch (err) {
        setCmdOutput(`ERROR: ${err.message}`)
        setRunStatus({ text: 'Batch execution failed', type: 'err' })
      } finally {
        setIsExecuting(false)
      }
    }

    runBatch()
  }

  // Discover registered credentials (all or selected only)
  const handleDiscover = async (onlySelected = false) => {
    if (devices.length === 0) {
      setDiscoverStatus('No devices registered to discover')
      return
    }

    if (onlySelected && selectedDeviceIps.size === 0) {
      setDiscoverStatus('No devices selected to discover')
      return
    }

    const devicesToDiscover = onlySelected
      ? Array.from(selectedDeviceIps).map(name => devices.find(d => d.device_name === name)).filter(Boolean)
      : devices

    if (devicesToDiscover.length === 0) {
      setDiscoverStatus('No valid devices found to discover')
      return
    }

    setIsDiscovering(true)
    discoveryCancelRef.current = false
    setDiscoveryTotal(devicesToDiscover.length)
    setDiscoveryProgress(0)
    setDiscoveryResults(null)

    const accumulatedResults = []
    let hasError = false
    let cancelled = false

    for (let i = 0; i < devicesToDiscover.length; i++) {
      if (discoveryCancelRef.current) {
        cancelled = true
        break
      }

      const dev = devicesToDiscover[i]
      const ipAddr = dev.ip_address || dev.ip
      setDiscoverStatus(`Polling device ${i + 1}/${devicesToDiscover.length}: ${dev.device_name} (${ipAddr})...`)

      try {
        const payload = { ips: [ipAddr] }
        const res = await fetch(`${API}/api/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json().catch(() => ({}))
        
        if (discoveryCancelRef.current) {
          cancelled = true
          break
        }

        if (!res.ok) {
          accumulatedResults.push({
            device_name: dev.device_name,
            ip: ipAddr,
            category: dev.category || 'Host',
            status: 'error',
            commands: {},
            error: data.error || 'Discovery failed'
          })
          hasError = true
        } else {
          if (data.results && Array.isArray(data.results)) {
            accumulatedResults.push(...data.results)
          } else {
            accumulatedResults.push({
              device_name: dev.device_name,
              ip: ipAddr,
              category: dev.category || 'Host',
              status: 'success',
              commands: {},
              error: null
            })
          }
        }
      } catch (e) {
        if (discoveryCancelRef.current) {
          cancelled = true
          break
        }
        accumulatedResults.push({
          device_name: dev.device_name,
          ip: ipAddr,
          category: dev.category || 'Host',
          status: 'error',
          commands: {},
          error: e.message
        })
        hasError = true
      }

      setDiscoveryProgress(i + 1)
    }

    setDiscoveryResults({
      status: cancelled ? 'cancelled' : (hasError ? 'warning' : 'complete'),
      results: accumulatedResults,
      discovered_at: new Date().toISOString()
    })

    if (cancelled) {
      setDiscoverStatus('Discovery cancelled by user.')
    } else {
      setDiscoverStatus(hasError ? 'Discovery complete with some errors.' : 'Discovery complete!')
    }
    setIsDiscovering(false)
  }

  // Handle Delete Selected (Bulk Delete)
  const handleDeleteSelected = async () => {
    if (selectedDeviceIps.size === 0) return
    if (!window.confirm(`Delete ${selectedDeviceIps.size} selected devices?`)) return
    
    try {
      setDiscoverStatus(`Deleting ${selectedDeviceIps.size} devices...`)
      const names = Array.from(selectedDeviceIps)
      const res = await fetch(`${API}/api/credentials/delete-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_names: names }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
      
      setDiscoverStatus(`Successfully deleted ${data.deleted_count || names.length} devices`)
      setSelectedDeviceIps(new Set())
      await fetchDevices()
    } catch (e) {
      setDiscoverStatus(`Bulk delete failed: ${e.message}`)
    }
  }

  // Toggle selection for a specific device by its name
  const handleToggleSelectDevice = (name) => {
    setSelectedDeviceIps(prev => {
      const next = new Set(prev)
      const clickedDev = devices.find(d => d.device_name === name)
      const isChecking = !next.has(name)
      
      const affectedNames = [name]
      if (clickedDev && clickedDev.category === 'Array') {
        const arrayName = clickedDev.device_name
        const dependentSwitches = devices.filter(d => d.category === 'Switch' && d.connected_to === arrayName)
        dependentSwitches.forEach(s => {
          affectedNames.push(s.device_name)
          
          const dependentHosts = devices.filter(h => h.category === 'Host' && h.connected_to === s.device_name)
          dependentHosts.forEach(h => {
            affectedNames.push(h.device_name)
          })
        })
      } else if (clickedDev && clickedDev.category === 'Switch') {
        const switchName = clickedDev.device_name
        const dependentHosts = devices.filter(h => h.category === 'Host' && h.connected_to === switchName)
        dependentHosts.forEach(h => {
          affectedNames.push(h.device_name)
        })
      }
      
      affectedNames.forEach(tName => {
        if (isChecking) {
          next.add(tName)
        } else {
          next.delete(tName)
        }
      })
      
      return next
    })
  }

  // Toggle selection for all devices
  const handleToggleSelectAll = (checked) => {
    if (checked) {
      const allNames = devices.map(d => d.device_name).filter(Boolean)
      setSelectedDeviceIps(new Set(allNames))
    } else {
      setSelectedDeviceIps(new Set())
    }
  }

  // Add custom command to list
  const handleAddCustomCommand = () => {
    const cmd = newCustomCommand.trim()
    if (!cmd) return
    if (!customCommands.includes(cmd)) {
      setCustomCommands(prev => [...prev, cmd])
      setSelectedCommands(prev => [...prev, cmd])
    }
    setNewCustomCommand('')
  }

  // Remove custom command
  const handleRemoveCustomCommand = (cmd) => {
    setCustomCommands(prev => prev.filter(c => c !== cmd))
    setSelectedCommands(prev => prev.filter(c => c !== cmd))
    if (selectedMockCmd === cmd) {
      setSelectedMockCmd('')
    }
    setMockCommands(prev => {
      const copy = { ...prev }
      delete copy[cmd]
      return copy
    })
  }

  // Load mock output values when selectedMockCmd changes
  useEffect(() => {
    if (selectedMockCmd) {
      const entry = mockCommands[selectedMockCmd] || { stdout: '', stderr: '', exit_code: 0 }
      setMockStdout(entry.stdout || '')
      setMockStderr(entry.stderr || '')
      setMockExitCode(entry.exit_code || 0)
    }
  }, [selectedMockCmd, mockCommands])

  // Apply mock output override
  const handleApplyMockOverride = () => {
    if (!selectedMockCmd) return
    setMockCommands(prev => ({
      ...prev,
      [selectedMockCmd]: {
        stdout: mockStdout,
        stderr: mockStderr,
        exit_code: parseInt(mockExitCode || '0', 10)
      }
    }))
    alert(`Applied mock override for "${selectedMockCmd}"`)
  }

  // Get all commands currently available for selection
  const allAvailableCommands = [
    ...(PRESET_COMMANDS[category] || []),
    ...customCommands
  ]

  const allIps = devices.map(d => d.ip_address || d.ip).filter(Boolean)
  const isAllSelected = devices.length > 0 && selectedDeviceIps.size === devices.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">SSH Ring Manager</h2>
          <p className="page-subtitle">Configure SSH credentials, custom commands, and virtual mock devices for the SAN ring</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 20 }}>
        {/* Form: Add/Edit Credentials */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
            {isEditing ? 'Edit Device Credentials' : 'Register New Device'}
          </h2>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Device Name</label>
                <input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. PROD-A-N0"
                  required
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>In-band IP Address</label>
                <input
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="e.g. 192.168.1.50"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Out-of-band IP (Optional)</label>
                <input
                  value={oobIp}
                  onChange={(e) => setOobIp(e.target.value)}
                  placeholder="e.g. 192.168.2.50"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
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
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Name (Optional)</label>
                <input
                  value={dnsName}
                  onChange={(e) => setDnsName(e.target.value)}
                  placeholder="e.g. host-prod-1"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Server (Optional)</label>
                <input
                  value={dnsServer}
                  onChange={(e) => setDnsServer(e.target.value)}
                  placeholder="e.g. 8.8.8.8"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={deviceKind === 'mock' && vsanDeviceType !== 'custom'}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(0, 0, 0, 0.2)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                >
                  <option value="Host" style={{ background: '#1a1a1a', color: '#fff' }}>Host</option>
                  <option value="Array" style={{ background: '#1a1a1a', color: '#fff' }}>Array</option>
                  <option value="Switch" style={{ background: '#1a1a1a', color: '#fff' }}>Switch</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Team Scope</label>
                {(() => {
                  const getTeamAccentColor = (teamName) => {
                    const colors = ['#58a6ff', '#3fb950', '#bc8cff', '#f0883e', '#ff7b72']
                    if (!teamName) return ''
                    const idx = teamName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
                    return colors[Math.abs(idx) % colors.length]
                  }

                  const activeColor = getTeamAccentColor(deviceTeam)

                  return (
                    <select
                      value={deviceTeam}
                      onChange={(e) => setDeviceTeam(e.target.value)}
                      style={{
                        width: '100%', padding: '9px 12px', borderRadius: 8,
                        border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(0, 0, 0, 0.2)',
                        color: activeColor || 'var(--foreground)', fontWeight: activeColor ? 600 : 400,
                        outline: 'none'
                      }}
                    >
                      {availableTeams.length > 0 ? (
                        availableTeams.map(t => {
                          const col = getTeamAccentColor(t.name)
                          return (
                            <option key={t.id || t.name} value={t.name} style={{ background: '#1a1a1a', color: col || '#fff', fontWeight: col ? 600 : 400 }}>
                              {t.name}
                            </option>
                          )
                        })
                      ) : (
                        <option value="" style={{ background: '#1a1a1a', color: '#fff' }}>Loading teams...</option>
                      )}
                    </select>
                  )
                })()}
              </div>
              {category === 'Switch' && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Dependent Array</label>
                  {(() => {
                    const getTeamAccentColor = (teamName) => {
                      const colors = ['#58a6ff', '#3fb950', '#bc8cff', '#f0883e', '#ff7b72']
                      if (!teamName) return ''
                      const idx = teamName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
                      return colors[Math.abs(idx) % colors.length]
                    }

                    const parentDev = devices.find(d => d.device_name === connectedTo)
                    const activeColor = parentDev ? getTeamAccentColor(parentDev.team) : ''

                    return (
                      <select
                        value={connectedTo}
                        onChange={(e) => setConnectedTo(e.target.value)}
                        style={{
                          width: '100%', padding: '9px 12px', borderRadius: 8,
                          border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(0, 0, 0, 0.2)',
                          color: activeColor || 'var(--foreground)', fontWeight: activeColor ? 600 : 400,
                          outline: 'none'
                        }}
                      >
                        <option value="" style={{ background: '#1a1a1a', color: '#fff' }}>None</option>
                        {devices.filter(d => d.category === 'Array').map(d => {
                          const col = getTeamAccentColor(d.team)
                          return (
                            <option key={d.device_name} value={d.device_name} style={{ background: '#1a1a1a', color: col || '#fff', fontWeight: col ? 600 : 400 }}>
                              {d.device_name}
                            </option>
                          )
                        })}
                      </select>
                    )
                  })()}
                </div>
              )}
              {category === 'Host' && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Dependent Device</label>
                  {(() => {
                    const getTeamAccentColor = (teamName) => {
                      const colors = ['#58a6ff', '#3fb950', '#bc8cff', '#f0883e', '#ff7b72']
                      if (!teamName) return ''
                      const idx = teamName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
                      return colors[Math.abs(idx) % colors.length]
                    }

                    const parentDev = devices.find(d => d.device_name === connectedTo)
                    const activeColor = parentDev ? getTeamAccentColor(parentDev.team) : ''

                    return (
                      <select
                        value={connectedTo}
                        onChange={(e) => setConnectedTo(e.target.value)}
                        style={{
                          width: '100%', padding: '9px 12px', borderRadius: 8,
                          border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(0, 0, 0, 0.2)',
                          color: activeColor || 'var(--foreground)', fontWeight: activeColor ? 600 : 400,
                          outline: 'none'
                        }}
                      >
                        <option value="" style={{ background: '#1a1a1a', color: '#fff' }}>None</option>
                        {devices.filter(d => d.category === 'Switch' || d.category === 'Array').map(d => {
                          const col = getTeamAccentColor(d.team)
                          return (
                            <option key={d.device_name} value={d.device_name} style={{ background: '#1a1a1a', color: col || '#fff', fontWeight: col ? 600 : 400 }}>
                              {d.device_name} (Category: {d.category})
                            </option>
                          )
                        })}
                      </select>
                    )
                  })()}
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={deviceKind === 'mock' ? 'simulator' : 'e.g. root'}
                  required={deviceKind === 'real'}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={deviceKind === 'mock' ? 'None' : 'SSH password'}
                  required={deviceKind === 'real'}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
            </div>

            {/* Custom Commands Management Section */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, marginTop: 5 }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 6 }}>
                Manage Custom Commands
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={newCustomCommand}
                  onChange={(e) => setNewCustomCommand(e.target.value)}
                  placeholder="e.g. df -h"
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: 6,
                    border: '1px solid rgba(1, 169, 130, 0.25)', background: 'rgba(255, 255, 255, 0.03)',
                    color: 'var(--foreground)', outline: 'none', fontSize: '12px'
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddCustomCommand}
                  style={{
                    padding: '7px 12px', borderRadius: 6, border: 'none',
                    background: 'var(--hpe-green)', color: 'white', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px'
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              {customCommands.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 100, overflowY: 'auto', padding: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 6 }}>
                  {customCommands.map((cmd) => (
                    <div key={cmd} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--foreground)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{cmd}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomCommand(cmd)}
                        style={{ border: 'none', background: 'transparent', color: '#ff6b6b', cursor: 'pointer' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Commands to Persist */}
            <div style={{ marginTop: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                  Commands to Persist / Execute ({selectedCommands.length} selected)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedCommands(allAvailableCommands)}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--foreground)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCommands([])}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--foreground)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Deselect All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCommands(prev => allAvailableCommands.filter(c => !prev.includes(c)))}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--foreground)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Invert
                  </button>
                </div>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px',
                padding: '10px', borderRadius: 8, border: '1px solid rgba(1, 169, 130, 0.2)',
                background: 'rgba(0, 0, 0, 0.25)', maxHeight: '120px', overflowY: 'auto'
              }}>
                {allAvailableCommands.map((cmd) => {
                  const isChecked = selectedCommands.includes(cmd)
                  return (
                    <label key={cmd} style={{
                      display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px',
                      cursor: 'pointer', color: isChecked ? 'var(--foreground)' : 'var(--muted)'
                    }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedCommands(prev => [...prev, cmd])
                          } else {
                            setSelectedCommands(prev => prev.filter(c => c !== cmd))
                          }
                        }}
                        style={{ accentColor: 'var(--hpe-green)', cursor: 'pointer' }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cmd}>
                        {cmd}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="submit"
                style={{
                  flex: 2, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid var(--hpe-green)', background: 'rgba(1, 169, 130, 0.15)',
                  color: 'var(--hpe-green)', fontWeight: 700, cursor: 'pointer',
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
                    setDnsName('')
                    setDnsServer('')
                    setCategory('Host')
                    setDeviceKind('real')
                    setVsanDeviceType('host')
                    setSelectedCommands([])
                    setCustomCommands([])
                    setMockCommands({})
                    setSelectedMockCmd('')
                    setOriginalDeviceName('')
                  }}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.2)', background: 'rgba(255, 255, 255, 0.05)',
                    color: 'var(--muted)', cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {saveStatus.text && (
            <div style={{
              fontSize: '13px', marginTop: 4,
              color: saveStatus.type === 'ok' ? 'var(--hpe-green)' : '#ff6b6b'
            }}>
              {saveStatus.text}
            </div>
          )}
        </div>

        {/* Form: Run commands against saved credentials */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
            Run Commands
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
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
                {targetOobIp && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Route via:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setUseOobIp(false)
                        if (targetInbandIp) setTargetIp(targetInbandIp)
                      }}
                      style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                        border: '1px solid var(--line)',
                        background: !useOobIp ? 'rgba(1, 169, 130, 0.15)' : 'transparent',
                        color: !useOobIp ? 'var(--hpe-green)' : 'var(--muted)',
                        fontWeight: !useOobIp ? 600 : 400
                      }}
                    >
                      In-band ({targetInbandIp})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUseOobIp(true)
                        if (targetOobIp) setTargetIp(targetOobIp)
                      }}
                      style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                        border: '1px solid var(--line)',
                        background: useOobIp ? 'rgba(1, 169, 130, 0.15)' : 'transparent',
                        color: useOobIp ? 'var(--hpe-green)' : 'var(--muted)',
                        fontWeight: useOobIp ? 600 : 400
                      }}
                    >
                      OOB ({targetOobIp})
                    </button>
                  </div>
                )}
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>DNS Name</label>
                <input
                  value={targetDnsName}
                  onChange={(e) => setTargetDnsName(e.target.value)}
                  placeholder="c3-dl380g11-25"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
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
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
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
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
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
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(0, 0, 0, 0.2)',
                    color: 'var(--foreground)', outline: 'none'
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
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
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
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--foreground)', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                  Preset Commands for {targetCategory} ({selectedPresets.length} selected)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedPresets(PRESET_COMMANDS[targetCategory] || [])}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--foreground)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPresets([])}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--foreground)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Deselect All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPresets(prev => (PRESET_COMMANDS[targetCategory] || []).filter(c => !prev.includes(c)))}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--foreground)', padding: '2px 6px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Invert
                  </button>
                </div>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px',
                padding: '12px', borderRadius: 8, border: '1px solid rgba(1, 169, 130, 0.2)',
                background: 'rgba(0, 0, 0, 0.25)', maxHeight: '120px', overflowY: 'auto', marginBottom: 10
              }}>
                {PRESET_COMMANDS[targetCategory]?.map((cmd) => {
                  const isChecked = selectedPresets.includes(cmd)
                  return (
                    <label key={cmd} style={{
                      display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
                      cursor: 'pointer', color: isChecked ? 'var(--foreground)' : 'var(--muted)',
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
                        style={{ accentColor: 'var(--hpe-green)', cursor: 'pointer' }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{cmd}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Custom Commands for Target Device */}
            {targetCustomCommands.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 6 }}>
                  Custom Commands for Target Device (Connect & Run will use checked ones)
                </label>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px',
                  padding: '12px', borderRadius: 8, border: '1px solid rgba(1, 169, 130, 0.2)',
                  background: 'rgba(0, 0, 0, 0.25)', maxHeight: '100px', overflowY: 'auto', marginBottom: 10
                }}>
                  {targetCustomCommands.map((cmd) => {
                    const isChecked = selectedCustomPresets.includes(cmd)
                    return (
                      <label key={cmd} style={{
                        display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
                        cursor: 'pointer', color: isChecked ? 'var(--foreground)' : 'var(--muted)',
                        transition: 'color 0.2s'
                      }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCustomPresets(prev => [...prev, cmd])
                            } else {
                              setSelectedCustomPresets(prev => prev.filter(c => c !== cmd))
                            }
                          }}
                          style={{ accentColor: 'var(--hpe-green)', cursor: 'pointer' }}
                        />
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{cmd}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: 4 }}>Command to run</label>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. ls"
                required
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(255, 255, 255, 0.04)',
                  color: 'var(--foreground)', fontFamily: 'var(--font-mono)', outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="submit"
                disabled={isExecuting}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid var(--hpe-green)', background: 'rgba(1, 169, 130, 0.15)',
                  color: 'var(--hpe-green)', fontWeight: 700, cursor: isExecuting ? 'not-allowed' : 'pointer',
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
                  padding: '10px 14px', borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.2)', background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--foreground)', fontWeight: 600, cursor: isExecuting ? 'not-allowed' : 'pointer'
                }}
              >
                Run Selected Batch
              </button>
            </div>
          </form>

          {runStatus.text && (
            <div style={{
              fontSize: '13px', color: runStatus.type === 'ok' ? 'var(--hpe-green)' : '#ff6b6b'
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
          margin: 0, padding: 14, maxHeight: 280, overflow: 'auto',
          color: '#eaf1ff', background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(1, 169, 130, 0.25)', borderRadius: 8,
          fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: 1.5,
          whiteSpace: 'pre-wrap'
        }}>
          {cmdOutput}
        </pre>
      </div>

      {/* Saved Devices Table */}
      <div className="glass-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            Registered Devices
          </h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => handleDiscover(true)}
              disabled={isDiscovering || selectedDeviceIps.size === 0}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: '11px', fontWeight: 'bold',
                border: '1px solid var(--hpe-green)',
                background: selectedDeviceIps.size === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(1, 169, 130, 0.1)',
                color: selectedDeviceIps.size === 0 ? 'var(--muted)' : 'var(--hpe-green)',
                cursor: isDiscovering || selectedDeviceIps.size === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              Poll Selected ({selectedDeviceIps.size})
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedDeviceIps.size === 0}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: '11px', fontWeight: 'bold',
                border: '1px solid #ff4d4d',
                background: selectedDeviceIps.size === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255, 77, 77, 0.1)',
                color: selectedDeviceIps.size === 0 ? 'var(--muted)' : '#ff7b72',
                cursor: selectedDeviceIps.size === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              Delete Selected ({selectedDeviceIps.size})
            </button>
            <button
              onClick={() => handleDiscover(false)}
              disabled={isDiscovering || devices.length === 0}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: '11px', fontWeight: 'bold',
                border: '1px solid var(--hpe-green)', background: 'rgba(1, 169, 130, 0.15)',
                color: 'var(--hpe-green)', cursor: isDiscovering ? 'not-allowed' : 'pointer'
              }}
            >
              {isDiscovering ? 'Discovering...' : 'Discover All'}
            </button>
            <button
              onClick={fetchDevices}
              className="btn"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', height: 28 }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {discoverStatus && (
          <div style={{
            position: 'fixed',
            top: '80px',
            right: '20px',
            zIndex: 9999,
            background: '#ffffff',
            border: '1px solid var(--hpe-green)',
            borderRadius: '8px',
            padding: '12px 14px',
            color: '#1a1a1a',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            width: '290px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            transition: 'all 0.3s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: isDiscovering ? 'var(--hpe-green)' : '#8b949e' }} />
                <span style={{ fontWeight: 600, color: 'var(--hpe-green)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {isDiscovering ? 'Discovery Active' : 'Discovery Idle'}
                </span>
              </div>
              <button 
                onClick={() => setDiscoverStatus('')} 
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '9px', padding: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = '#333'}
                onMouseLeave={e => e.currentTarget.style.color = '#888'}
              >
                Dismiss
              </button>
            </div>
            
            <div style={{ color: '#333', lineHeight: 1.4 }}>
              {discoverStatus}
            </div>

            {isDiscovering && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {discoveryTotal > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 3, background: 'rgba(0,0,0,0.08)', borderRadius: 1.5, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${(discoveryProgress / discoveryTotal) * 100}%`,
                          background: 'var(--hpe-green)',
                          transition: 'width 0.2s ease-in-out'
                        }}
                      />
                    </div>
                    <span style={{ fontWeight: 'bold', color: 'var(--hpe-green)' }}>
                      {Math.round((discoveryProgress / discoveryTotal) * 100)}%
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCancelDiscovery}
                  style={{
                    alignSelf: 'flex-end',
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '9px',
                    fontWeight: 'bold',
                    border: '1px solid #ff4d4d',
                    background: 'rgba(255, 77, 77, 0.1)',
                    color: '#ff7b72',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 77, 77, 0.25)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 77, 77, 0.1)' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {loadingDevices ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '10px 0' }}>Loading device index...</div>
        ) : devices.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '10px 0' }}>No registered SSH devices. Create one above to get started.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 8px', width: '30px' }}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                      style={{ accentColor: 'var(--hpe-green)', cursor: 'pointer' }}
                    />
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Device Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Category</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Team</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Connected to</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>IP Address</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>DNS Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>DNS Server</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Username</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Port</th>
                  <th style={{ textAlign: 'right', padding: '10px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 700 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device, idx) => {
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '12px 8px' }}>
                        {device.device_name && (
                          <input
                            type="checkbox"
                            checked={selectedDeviceIps.has(device.device_name)}
                            onChange={() => handleToggleSelectDevice(device.device_name)}
                            style={{ accentColor: 'var(--hpe-green)', cursor: 'pointer' }}
                          />
                        )}
                      </td>
                      <td 
                        onClick={() => {
                          sessionStorage.setItem('target_focused_node_id', device.device_name || device.ip)
                          navigate('/topology')
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          sessionStorage.setItem('target_console_device_name', device.device_name || device.ip)
                          navigate('/emulator')
                        }}
                        style={{ 
                          padding: '12px 8px', fontSize: '13px', fontWeight: 600, 
                          color: 'var(--accent-blue)', cursor: 'pointer', textDecoration: 'underline' 
                        }}
                        title="Click: Dashboard | Right-click: SSH Console"
                      >
                        {device.device_name}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: '11px', fontWeight: 'bold',
                          background: device.category === 'Array' ? 'rgba(0, 200, 255, 0.15)' : device.category === 'Switch' ? 'rgba(255, 170, 0, 0.15)' : 'rgba(128, 128, 128, 0.15)',
                          color: device.category === 'Array' ? '#00c8ff' : device.category === 'Switch' ? '#ffaa00' : 'var(--muted)',
                          border: `1px solid ${device.category === 'Array' ? 'rgba(0, 200, 255, 0.3)' : device.category === 'Switch' ? 'rgba(255, 170, 0, 0.3)' : 'rgba(128, 128, 128, 0.3)'}`
                        }}>
                          {device.category || 'Host'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                        {(() => {
                          const tName = device.team || 'team-alpha';
                          const palettes = [
                            { bg: 'rgba(56, 139, 253, 0.1)', border: 'rgba(56, 139, 253, 0.3)', text: '#58a6ff' },
                            { bg: 'rgba(46, 160, 67, 0.1)', border: 'rgba(46, 160, 67, 0.3)', text: '#3fb950' },
                            { bg: 'rgba(187, 128, 250, 0.1)', border: 'rgba(187, 128, 250, 0.3)', text: '#bc8cff' },
                            { bg: 'rgba(219, 109, 40, 0.1)', border: 'rgba(219, 109, 40, 0.3)', text: '#f0883e' },
                            { bg: 'rgba(244, 63, 94, 0.1)', border: 'rgba(244, 63, 94, 0.3)', text: '#ff7b72' }
                          ];
                          const idx = availableTeams.length > 0 
                            ? availableTeams.findIndex(x => x.name === tName)
                            : tName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                          const colors = palettes[Math.abs(idx) % palettes.length];
                          return (
                            <span style={{
                              padding: '2px 6px', borderRadius: 4, fontSize: '11px', fontWeight: '600',
                              background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`
                            }}>
                              {tName}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                        {device.category === 'Host' || device.category === 'Switch' ? (
                          device.connected_to ? (
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4, fontSize: '11px' }}>
                              {device.connected_to}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted)', fontSize: '11px' }}>None</span>
                          )
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                        <div style={{ fontFamily: 'var(--font-mono)' }}>{device.ip_pending ? '-' : (device.ip_address || device.ip || '-')}</div>
                        {device.ip_pending && (
                          <div style={{ fontSize: '10px', color: '#e0a800', fontWeight: 'bold', marginTop: 2 }}>
                            IP Pending
                          </div>
                        )}
                        {device.oob_ip && (
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 2 }}>
                            OOB: <span style={{ fontFamily: 'var(--font-mono)' }}>{device.oob_ip}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.dns_name || '-'}</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.dns_server || '-'}</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                        {device.username_pending ? '-' : (device.username || '-')}
                        {device.username_pending && device.password_pending && device.ip_pending ? (
                          <div style={{ fontSize: '10px', color: '#e0a800', fontWeight: 'bold', marginTop: 2 }}>
                            Credentials Pending
                          </div>
                        ) : device.username_pending && device.password_pending ? (
                          <div style={{ fontSize: '10px', color: '#e0a800', fontWeight: 'bold', marginTop: 2 }}>
                            Credentials Pending
                          </div>
                        ) : device.password_pending ? (
                          <div style={{ fontSize: '10px', color: '#e0a800', fontWeight: 'bold', marginTop: 2 }}>
                            Password Pending
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{device.port}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleUse(device)}
                            style={{
                              padding: '6px 10px', borderRadius: 6, fontSize: '11px',
                              border: '1px solid var(--hpe-green)', background: 'rgba(1, 169, 130, 0.08)',
                              color: 'var(--hpe-green)', cursor: 'pointer'
                            }}
                          >
                            Use
                          </button>
                          <button
                            onClick={() => handleEdit(device)}
                            style={{
                              padding: '6px 10px', borderRadius: 6, fontSize: '11px',
                              border: '1px solid rgba(255, 255, 255, 0.2)', background: 'rgba(255, 255, 255, 0.05)',
                              color: 'var(--foreground)', cursor: 'pointer'
                            }}
                          >
                            Edit
                          </button>
                          {user?.role !== 'team_member' && (
                            <button
                              onClick={() => handleDelete(device)}
                              style={{
                                padding: '6px 10px', borderRadius: 6, fontSize: '11px',
                                border: '1px solid rgba(255, 107, 107, 0.3)', background: 'rgba(255, 107, 107, 0.08)',
                                color: '#ff6b6b', cursor: 'pointer'
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Discovery Results Display */}
      {discoveryResults && discoveryResults.results && (
        <div className="glass-card" style={{ padding: 20 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(1, 169, 130, 0.2)', paddingBottom: 8 }}>
            Discovery Results (Discovered at: {new Date(discoveryResults.discovered_at).toLocaleString()})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {discoveryResults.results.map((res, i) => (
              <div key={i} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{
                  padding: '10px 14px', background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.06)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{res.device_name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>({res.ip})</span>
                  </div>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '11px', fontWeight: 'bold',
                    background: res.status === 'success' ? 'rgba(0,200,83,0.15)' : res.status === 'warning' ? 'rgba(255,170,0,0.15)' : 'rgba(255,107,107,0.15)',
                    color: res.status === 'success' ? '#00e676' : res.status === 'warning' ? '#ffaa00' : '#ff6b6b'
                  }}>
                    {res.status.toUpperCase()}
                  </span>
                </div>

                {res.error && (
                  <div style={{ padding: 12, color: '#ff6b6b', fontSize: '12px', background: 'rgba(255,107,107,0.05)', fontFamily: 'var(--font-mono)' }}>
                    Error: {res.error}
                  </div>
                )}

                {res.commands && Object.keys(res.commands).length > 0 && (
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(res.commands).map(([cmd, out]) => (
                      <div key={cmd} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ padding: '6px 10px', fontSize: '11px', fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'var(--hpe-green)' }}>
                          $ {cmd} (Exit Code: {out.exit_code})
                        </div>
                        <pre style={{
                          margin: 0, padding: 10, maxHeight: 150, overflow: 'auto',
                          fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: '#eaf1ff'
                        }}>
                          {out.stdout || (out.stderr ? `[ERROR] ${out.stderr}` : '(no output)')}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
