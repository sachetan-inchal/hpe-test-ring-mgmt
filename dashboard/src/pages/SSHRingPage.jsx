import { useState, useEffect } from 'react'
import { Server, Terminal, Plus, Trash2, Edit2, Check, X, Clipboard, Cpu, Sparkles } from 'lucide-react'
import EmbeddedTerminal from '../components/EmbeddedTerminal'

const PRELOADED_DEVICES = [
  { id: '1', ip: '172.17.1.26', username: 'u0_a282', password: 'sachetan', port: 8022, label: 'Termux (Android Phone)', selected: true },
  { id: '2', ip: '172.17.7.224', username: 'sachetan', password: 'sachetan123', port: 22, label: 'Zorin OS (Old Laptop)', selected: true },
  { id: '3', ip: '172.23.109.228', username: 'sachetan', password: 'sachetan', port: 22, label: 'WSL Ubuntu (New Laptop)', selected: true }
]

export default function SSHRingPage({ apiBase }) {
  const API = apiBase || ''
  
  // Device Manager States
  const [devices, setDevices] = useState(() => {
    const saved = localStorage.getItem('ssh_ring_devices')
    return saved ? JSON.parse(saved) : PRELOADED_DEVICES
  })

  // Edit / Add Form States
  const [isEditing, setIsEditing] = useState(false) // false or device id
  const [form, setForm] = useState({ label: '', ip: '', username: '', password: '', port: 22 })
  const [showAddForm, setShowAddForm] = useState(false)

  // Copy Feedback state
  const [copiedId, setCopiedId] = useState(null)

  // Persist device configurations locally
  useEffect(() => {
    localStorage.setItem('ssh_ring_devices', JSON.stringify(devices))
  }, [devices])

  // ── Toggle Device Selection ────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setDevices(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d))
  }

  // ── Form Actions ───────────────────────────────────────────────────────────
  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.ip || !form.username || !form.password) {
      alert('IP, Username, and Password are required!')
      return
    }
    const newDevice = {
      id: Date.now().toString(),
      label: form.label || `Device ${form.ip}`,
      ip: form.ip,
      username: form.username,
      password: form.password,
      port: parseInt(form.port) || 22,
      selected: true
    }
    setDevices(prev => [...prev, newDevice])
    setForm({ label: '', ip: '', username: '', password: '', port: 22 })
    setShowAddForm(false)
  }

  const startEdit = (dev) => {
    setIsEditing(dev.id)
    setForm({ label: dev.label, ip: dev.ip, username: dev.username, password: dev.password, port: dev.port })
  }

  const handleSaveEdit = (e) => {
    e.preventDefault()
    setDevices(prev => prev.map(d => d.id === isEditing ? { ...d, ...form, port: parseInt(form.port) || 22 } : d))
    setIsEditing(false)
    setForm({ label: '', ip: '', username: '', password: '', port: 22 })
  }

  const handleDelete = (id) => {
    if (!window.confirm('Remove this device configuration?')) return
    setDevices(prev => prev.filter(d => d.id !== id))
    if (isEditing === id) setIsEditing(false)
  }

  // ── Copy SSH Command to Clipboard with -t flag (Force TTY Allocation) ──────
  const copySSHCommand = (dev) => {
    // -t forces pseudo-terminal allocation, which enables full interactive logins in piped terminal shells
    const cmd = dev.port === 22 
      ? `ssh -t ${dev.username}@${dev.ip}`
      : `ssh -t -p ${dev.port} ${dev.username}@${dev.ip}`
    
    navigator.clipboard.writeText(cmd)
    setCopiedId(dev.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">SSH Ring Manager</h2>
          <p className="page-subtitle">Configure SSH hosts, copy connection strings, and run live terminals natively in a hidden background subprocess shell</p>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16, flexWrap: 'wrap' }}>
        {/* Left pane: Device List and forms */}
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 320 }}>
          {/* List panel */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Server size={18} style={{ color: 'var(--hpe-green)' }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>SSH Device Ring</span>
              </div>
              {!showAddForm && !isEditing && (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', background: 'rgba(1,169,130,0.15)',
                    border: '1px solid var(--hpe-green)', borderRadius: 6,
                    color: 'var(--hpe-green)', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  <Plus size={12} /> Add Device
                </button>
              )}
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 420 }}>
              {devices.map(dev => (
                <div
                  key={dev.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', borderRadius: 8,
                    background: dev.selected ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                    border: `1px solid ${dev.selected ? 'rgba(1,169,130,0.3)' : 'var(--line)'}`,
                    transition: 'all 0.2s'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={dev.selected}
                    onChange={() => toggleSelect(dev.id)}
                    style={{
                      width: 16, height: 16, accentColor: 'var(--hpe-green)', cursor: 'pointer'
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{dev.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 4 }}>
                        Port {dev.port}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginTop: 4 }}>
                      ssh -t {dev.username}@{dev.ip}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      onClick={() => copySSHCommand(dev)}
                      title="Copy SSH command with PTY flags"
                      style={{
                        padding: '6px 10px',
                        background: 'rgba(1,169,130,0.15)',
                        border: '1px solid var(--hpe-green)',
                        borderRadius: 6,
                        color: 'var(--hpe-green)',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      <Clipboard size={12} />
                      <span>{copiedId === dev.id ? 'Copied!' : 'Copy SSH'}</span>
                    </button>
                    <button
                      onClick={() => startEdit(dev)}
                      title="Edit device"
                      style={{
                        padding: 6, background: 'transparent', border: 'none',
                        color: 'var(--muted)', cursor: 'pointer', borderRadius: 4
                      }}
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(dev.id)}
                      title="Delete device"
                      style={{
                        padding: 6, background: 'transparent', border: 'none',
                        color: 'rgba(248,81,73,0.7)', cursor: 'pointer', borderRadius: 4
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form Panel (Add / Edit) */}
          {(showAddForm || isEditing) && (
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--hpe-green)' }}>
                  {showAddForm ? '➕ ADD NEW SSH CONNECTION' : '✏️ EDIT SSH CONNECTION'}
                </h4>
                <button
                  onClick={() => { setShowAddForm(false); setIsEditing(false) }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={showAddForm ? handleAdd : handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Label</label>
                    <input
                      className="input"
                      value={form.label}
                      onChange={e => setForm({ ...form, label: e.target.value })}
                      placeholder="e.g. Zorin Laptop"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Port</label>
                    <input
                      className="input"
                      type="number"
                      value={form.port}
                      onChange={e => setForm({ ...form, port: e.target.value })}
                      placeholder="22"
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Host / IP Address</label>
                  <input
                    className="input"
                    value={form.ip}
                    onChange={e => setForm({ ...form, ip: e.target.value })}
                    placeholder="e.g. 172.17.7.224"
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Username</label>
                    <input
                      className="input"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      placeholder="root"
                      required
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password</label>
                    <input
                      className="input"
                      type="password"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••"
                      required
                    />
                  </div>
                </div>

                <button className="btn btn-primary" type="submit" style={{ marginTop: 6 }}>
                  {showAddForm ? 'Add Configuration' : 'Save Changes'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right pane: Real Embedded Terminal */}
        <div style={{ flex: '2 1 500px', display: 'flex', flexDirection: 'column', minWidth: 320, height: '100%', minHeight: 450 }}>
          <div className="terminal-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0d12' }}>
            <div className="terminal-header" style={{ background: '#11161d', borderBottom: '1px solid var(--line)' }}>
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8, flex: 1, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Terminal size={12} /> Interactive Embedded Console (PTY Mode)
              </span>
            </div>

            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <EmbeddedTerminal apiBase={API} active={true} />
            </div>
          </div>

          {/* Instructions */}
          <div style={{ fontSize: 11, color: 'var(--muted)', background: 'rgba(88,166,255,0.04)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: 8, padding: 14, marginTop: 12 }}>
            <div style={{ fontWeight: 600, color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Sparkles size={13} /> Interactive PTY Terminal Guide
            </div>
            <ol style={{ paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Click <strong>Copy SSH</strong> next to Zorin OS, WSL, or Termux in your ring. The command string has been automatically appended with the <code>-t</code> flag to force Pseudo-terminal allocation.</li>
              <li>Paste the command directly into the <strong>Interactive Embedded Console</strong> above and hit <strong>Enter</strong>.</li>
              <li>Type the password and interact normally! Backspace, auto-completion, and text inputs will handle perfectly inside the browser window.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
