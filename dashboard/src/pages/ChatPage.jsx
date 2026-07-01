import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { AuthContext } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Sparkles, Database, MessageSquare, Plus, RotateCcw, Bot, Trash2, Copy, Check, Upload, FileText, CheckCircle2, AlertTriangle, X, Cpu, Monitor, Server } from 'lucide-react'
import AgentStepTimeline from '../components/AgentStepTimeline'
import RadialMenu from '../components/RadialMenu'
import AgentReasoningSidebar from '../components/AgentReasoningSidebar'

// ── Emulator constants (mirrors EmulatorPage) ──────────────────────────────
const EMU_ARRAY_CMDS = [
  { label: 'showsys', desc: 'System overview' },
  { label: 'shownode', desc: 'Node details' },
  { label: 'showport', desc: 'Port info' },
  { label: 'showpd', desc: 'Physical disks' },
  { label: 'showhost', desc: 'Connected hosts' },
  { label: 'showcage', desc: 'Drive cages' },
  { label: 'showportdev ns -nohdtot 0:3:1', desc: 'Port device NS' },
  { label: 'showversion -b', desc: 'Firmware version' },
]
const EMU_SWITCH_CMDS = [
  { label: 'fabricshow', desc: 'FC fabric topology' },
  { label: 'switchshow', desc: 'Switch state + ports' },
  { label: 'help', desc: 'Available commands' },
]
const EMU_HOST_LINUX_CMDS = [
  { label: 'uname -a', desc: 'OS info' },
  { label: 'hostname', desc: 'Hostname' },
  { label: 'ip addr show', desc: 'Network interfaces' },
  { label: 'multipath -ll', desc: 'Multipath status' },
]
const EMU_HOST_WIN_CMDS = [
  { label: 'Get-PhysicalDisk | Select-Object DeviceId, Model, FirmwareVersion', desc: 'Physical disks' },
  { label: 'Get-ComputerInfo', desc: 'OS & hardware' },
  { label: 'Get-HBaPort', desc: 'FC HBA ports' },
]
function emuGetDeviceCmds(device) {
  if (!device) return []
  const t = (device?.type || '').toLowerCase()
  const os = (device?.os || device?.os_name || '').toLowerCase()
  if (t === 'switch') return EMU_SWITCH_CMDS
  if (t === 'array' || t === 'arraysystem') return EMU_ARRAY_CMDS
  if (os.includes('windows')) return EMU_HOST_WIN_CMDS
  return EMU_HOST_LINUX_CMDS
}
function emuGetSSHUser(device) {
  return (device?.type || '').toLowerCase() === 'switch' ? 'admin' : 'root'
}
function emuGetDeviceKind(device) {
  if (!device) return 'host_linux'
  const t = (device?.type || '').toLowerCase()
  const os = (device?.os || device?.os_name || '').toLowerCase()
  if (t === 'switch') return 'switch'
  if (t === 'array' || t === 'arraysystem') return 'array'
  if (os.includes('windows')) return 'host_windows'
  return 'host_linux'
}
const EMU_COL = { cmd: '#3fb950', out: '#c9d1d9', error: '#f85149', info: '#58a6ff', warn: '#e3b341', ssh: '#d2a8ff' }

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    const plain = text.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/#+\s/g, '').trim()
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      style={{
        marginTop: 5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: copied ? 'var(--hpe-green)' : 'var(--muted)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '2px 6px',
        borderRadius: 4,
        transition: 'color 0.2s',
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

const QUICK_QUERIES = [
  { label: 'Hosts zoned with PROD-A + OS', text: 'Given array PROD-A, list all hosts along with the type of OS that are zoned with.' },
  { label: 'Arrays with failed PDs', text: 'List arrays that have one or more failed PDs' },
  { label: 'TPD version for PROD-A', text: 'Given array PROD-A, what is the TPD version?' },
  { label: 'Protocols on PROD-A', text: 'For array PROD-A, list all protocols that are supported' },
  { label: 'Switch state', text: 'Given array PROD-A, list the switch state' },
  { label: 'Capacity summary', text: 'List arrays that have more than 200TB usable space' },
]

function LLMIngestCard({ file, phase, step, logs = [], result, error, chunks = [] }) {
  const logsEndRef = useRef(null)
  const [expandedThink, setExpandedThink] = useState({})
  const [logsOpen, setLogsOpen] = useState(false)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length, chunks.length])

  const LLM_STEPS = [
    { label: 'Backup', icon: '🛡️' },
    { label: 'LLM Parse', icon: '🤖' },
    { label: 'Populate', icon: '🗄️' },
    { label: 'Snapshot', icon: '📸' },
  ]

  return (
    <div style={{
      width: '100%',
      maxWidth: 760,
      background: 'linear-gradient(145deg, rgba(22,27,34,0.98) 0%, rgba(13,17,23,0.98) 100%)',
      border: '1px solid rgba(72,79,88,0.5)',
      borderRadius: 16,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(1,169,130,0.04)',
      overflow: 'hidden',
      marginTop: 10,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid rgba(72,79,88,0.3)',
        background: 'linear-gradient(90deg, rgba(1,169,130,0.08) 0%, transparent 100%)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(1,169,130,0.3) 0%, rgba(88,166,255,0.2) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid rgba(1,169,130,0.3)',
        }}>
          <Cpu size={16} style={{ color: 'var(--hpe-green)' }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>SAN LLM Ingest Agent</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
            {file?.name || 'Processing log...'}{phase === 'running' ? ' — Parsing...' : ''}
          </div>
        </div>
        {phase === 'running' && (
          <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: 'var(--hpe-green)', animation: 'pulse 1s ease infinite', display: 'inline-block' }} />
        )}
        {phase === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--hpe-green)', marginLeft: 'auto' }} />}
        {phase === 'error' && <AlertTriangle size={16} style={{ color: '#f85149', marginLeft: 'auto' }} />}
      </div>

      {/* Step Pipeline */}
      <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid rgba(72,79,88,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {LLM_STEPS.map((s, i) => {
            const done = step > i || phase === 'done'
            const active = step === i && phase === 'running'
            const isLast = i === LLM_STEPS.length - 1
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 0 : 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                    background: done ? 'rgba(1,169,130,0.2)' : active ? 'rgba(88,166,255,0.15)' : 'rgba(72,79,88,0.2)',
                    border: `2px solid ${done ? 'rgba(1,169,130,0.6)' : active ? 'rgba(88,166,255,0.6)' : 'rgba(72,79,88,0.3)'}`,
                    boxShadow: active ? '0 0 10px rgba(88,166,255,0.3)' : 'none',
                    animation: active ? 'pulse 1.5s ease infinite' : 'none',
                    transition: 'all 0.4s ease',
                  }}>
                    {done ? <CheckCircle2 size={13} style={{ color: 'var(--hpe-green)' }} /> : s.icon}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: done ? 'var(--hpe-green)' : active ? 'var(--accent-blue)' : 'var(--muted)' }}>
                    {s.label}
                  </div>
                </div>
                {!isLast && (
                  <div style={{
                    flex: 1, height: 2, margin: '0 4px', marginTop: -14,
                    background: done ? 'var(--hpe-green)' : 'rgba(72,79,88,0.3)',
                    transition: 'background 0.4s ease', borderRadius: 1,
                  }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* LLM Chunk Panels — one per LLM call, matching normal SAN agent message style */}
      {chunks.length > 0 && (
        <div style={{ padding: '12px 18px 0' }}>
          {chunks.map((chunk) => {
            const thinkKey = chunk.idx
            const isOpen = expandedThink[thinkKey] !== false // default expanded
            const rawThink = chunk.thinking || ''
            const cleanThink = rawThink.replace(/^<think>/i, '').replace(/<\/think>$/i, '').trim()
            const hasThink = cleanThink.length > 0
            const cleanContent = (chunk.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
            return (
              <div key={chunk.idx} style={{
                marginBottom: 12, borderRadius: 10,
                border: '1px solid rgba(72,79,88,0.3)', overflow: 'hidden',
                background: 'rgba(255,255,255,0.02)',
              }}>
                {/* Chunk header */}
                <div style={{
                  padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(88,166,255,0.05)', borderBottom: '1px solid rgba(72,79,88,0.2)',
                }}>
                  <Cpu size={11} style={{ color: 'var(--accent-blue)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-blue)' }}>
                    LLM Call {chunk.idx}/{chunk.total}
                  </span>
                  {chunk.phase === 'running' && (
                    <span className="pulsing-dot" style={{ width: 6, height: 6, background: 'var(--hpe-green)', borderRadius: '50%', display: 'inline-block', marginLeft: 'auto' }} />
                  )}
                  {chunk.phase === 'done' && <CheckCircle2 size={11} style={{ color: 'var(--hpe-green)', marginLeft: 'auto' }} />}
                </div>

                {/* Think block — collapsible, same style as normal SAN agent */}
                {hasThink && (
                  <div style={{ background: 'rgba(0, 0, 0, 0.2)', borderBottom: cleanContent ? '1px solid rgba(72,79,88,0.15)' : 'none' }}>
                    <div
                      onClick={() => setExpandedThink(prev => ({ ...prev, [thinkKey]: !isOpen }))}
                      style={{
                        padding: '6px 14px', fontSize: 11, color: 'var(--muted)',
                        background: 'rgba(0,0,0,0.4)', cursor: 'pointer', borderBottom: '1px solid rgba(72,79,88,0.15)',
                        display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
                      }}
                    >
                      <Sparkles size={11} />
                      <span>AI Thinking Process</span>
                      {chunk.phase === 'running' && !rawThink.includes('</think>') && (
                        <span className="pulsing-dot" style={{ width: 5, height: 5, background: 'var(--hpe-green)', borderRadius: '50%', display: 'inline-block', marginLeft: 4 }} />
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>{isOpen ? '▲ collapse' : '▼ expand'}</span>
                    </div>
                    {isOpen && (
                      <div style={{
                        padding: '12px 14px', fontSize: 12, color: 'var(--text-secondary)',
                        fontStyle: 'italic', whiteSpace: 'pre-wrap',
                        maxHeight: chunk.phase === 'running' ? 'none' : 200, overflowY: 'auto',
                      }}>
                        {cleanThink}
                      </div>
                    )}
                  </div>
                )}

                {/* Streamed content */}
                {cleanContent && (
                  <div style={{
                    padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)',
                    maxHeight: 160, overflowY: 'auto',
                  }}>
                    {cleanContent}
                  </div>
                )}

                {/* Waiting placeholder while LLM call just started */}
                {!hasThink && !cleanContent && chunk.phase === 'running' && (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                    Waiting for LLM response...
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Progress / warning log — collapsible system log */}
      {logs.length > 0 && (
        <div style={{ margin: '8px 18px 0' }}>
          <div
            onClick={() => setLogsOpen(o => !o)}
            style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', userSelect: 'none' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)' }}>System Logs</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>{logsOpen ? '▲ hide' : `▼ ${logs.length} entries`}</span>
          </div>
          {logsOpen && (
            <div style={{
              maxHeight: 120, overflowY: 'auto', background: '#0a0c10',
              border: '1px solid rgba(72,79,88,0.3)', borderRadius: 8,
              padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.6,
            }}>
              {logs.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                  <span style={{ color: 'rgba(139,148,158,0.5)', flexShrink: 0 }}>{l.ts}</span>
                  <span style={{
                    color: l.type === 'error' ? '#f85149' : l.type === 'warn' ? '#d29922'
                      : l.type === 'success' ? '#3fb950' : l.type === 'system' ? '#bc8cff' : '#58a6ff'
                  }}>
                    {l.type === 'progress' ? '▶ ' : l.type === 'success' ? '✓ ' : l.type === 'warn' ? '⚠ ' : l.type === 'error' ? '✗ ' : '» '}
                    {l.msg}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Success state card */}
      {phase === 'done' && result && (
        <div style={{ margin: '12px 18px', padding: '12px 16px', background: 'rgba(1,169,130,0.08)', border: '1px solid rgba(1,169,130,0.25)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: result.arrays?.length > 0 ? 10 : 0 }}>
            <CheckCircle2 size={14} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--hpe-green)' }}>Ingest Complete</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
              {result.arrays_parsed ?? 0} array{(result.arrays_parsed ?? 0) !== 1 ? 's' : ''} loaded
            </span>
          </div>
          {result.arrays && result.arrays.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {result.arrays.map((arr, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(72,79,88,0.3)', borderRadius: 6,
                }}>
                  <Database size={11} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)' }}>{arr.name || 'Unnamed Array'}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>
                      {arr.model || ''}{arr.serial ? ` · S/N: ${arr.serial}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.snapshot_id && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>📸</span>
              Snapshot: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', fontSize: 9 }}>{result.snapshot_id}</code>
            </div>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 10, width: '100%', padding: '8px 0',
              background: 'var(--hpe-green)', border: 'none', borderRadius: 6,
              color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            🔄 Reload Dashboard to Apply
          </button>
        </div>
      )}

      {/* Error state card */}
      {phase === 'error' && (
        <div style={{ margin: '12px 18px', padding: '10px 14px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={12} style={{ color: '#f85149' }} />
            <span style={{ fontSize: 11, color: '#f85149', fontWeight: 600 }}>Ingest Failed</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{error}</div>
        </div>
      )}
      <div ref={logsEndRef} style={{ height: 12 }} />
    </div>
  )
}

export default function ChatPage({ apiBase, chatbotApi }) {
  const { user } = useContext(AuthContext)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastQuery, setLastQuery] = useState('')
  const [elapsedTime, setElapsedTime] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(260)
  const [emuPanelWidth, setEmuPanelWidth] = useState(480)
  const [aiMode, setAiMode] = useState('agent') // agent | standard | graphrag
  const [useOllama, setUseOllama] = useState(false)
  const [ollamaModel, setOllamaModel] = useState('qwen3:8b')
  const [disableThink, setDisableThink] = useState(false)
  const [chatHistory, setChatHistory] = useState([])
  const [currentRequestId, setCurrentRequestId] = useState(null)
  const activeEsRef = useRef(null)
  const activeReaderRef = useRef(null)

  // Live Terminal Connection States
  const [terminalType, setTerminalType] = useState('simulated')
  const [terminalMode, setTerminalMode] = useState('auto')
  const [sshHost, setSshHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPass, setSshPass] = useState('')
  const [pendingCommand, setPendingCommand] = useState(null)
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [selectedHwnd, setSelectedHwnd] = useState('')
  const [activeWindows, setActiveWindows] = useState([])
  const [loadingWindows, setLoadingWindows] = useState(false)
  const [activeChatId, setActiveChatId] = useState(null)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [agentResult, setAgentResult] = useState(null)
  const [llmCallsCount, setLlmCallsCount] = useState(0)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [showStepsInChat, setShowStepsInChat] = useState(true)
  const [arrayHint, setArrayHint] = useState(() => sessionStorage.getItem('agent_array_hint') || '')
  const [radialPos, setRadialPos] = useState(null)
  const [showTerminalPanel, setShowTerminalPanel] = useState(false)
  const terminalRef = useRef(null)
  const msgEndRef = useRef(null)
  const inputRef = useRef(null)
  const llmFileRef = useRef(null)

  // ── Emulator Gateway Mirror State ─────────────────────────────────────────
  const [emuDevices, setEmuDevices] = useState([])
  const [emuSshState, setEmuSshState] = useState('disconnected')
  const [emuActiveDevice, setEmuActiveDevice] = useState(null)
  const [emuHandshake, setEmuHandshake] = useState(null)
  const [emuPrompt, setEmuPrompt] = useState('console-gateway$ ')
  const [emuHistory, setEmuHistory] = useState([
    { type: 'info', text: 'HPE SAN Console Gateway v2.0.0 (Jump-Host Server)' },
    { type: 'info', text: '-------------------------------------------------' },
    { type: 'info', text: 'Type "ssh <user>@<ip>" or click a device to connect.' },
    { type: 'out', text: '' },
  ])
  const [emuInput, setEmuInput] = useState('')
  const [emuLoading, setEmuLoading] = useState(false)
  const [emuCmdHistory, setEmuCmdHistory] = useState([])
  const [emuHistIdx, setEmuHistIdx] = useState(-1)
  const [highlightedDevice, setHighlightedDevice] = useState(null)
  const emuTermBodyRef = useRef(null)
  const emuInputRef = useRef(null)

  // ── LLM Ingest State ─────────────────────────────────────────────────────
  // (State handled dynamically inside the messages array)

  // ── Right agent sidebar resize ──────────────────────────────────────────
  const isResizing = useRef(false)

  const handleMouseMove = useCallback((e) => {
    if (!isResizing.current) return
    const newWidth = window.innerWidth - e.clientX
    if (newWidth > 260 && newWidth < 800) {
      setSidebarWidth(newWidth)
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isResizing.current = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [handleMouseMove])

  const startResizing = useCallback((e) => {
    isResizing.current = true
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [handleMouseMove, handleMouseUp])

  // ── Left Knowledge Base sidebar resize ──────────────────────────────────
  const isResizingLeft = useRef(false)

  const handleLeftMouseMove = useCallback((e) => {
    if (!isResizingLeft.current) return
    const newWidth = e.clientX
    if (newWidth > 180 && newWidth < 520) {
      setLeftSidebarWidth(newWidth)
    }
  }, [])

  const handleLeftMouseUp = useCallback(() => {
    isResizingLeft.current = false
    document.removeEventListener('mousemove', handleLeftMouseMove)
    document.removeEventListener('mouseup', handleLeftMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [handleLeftMouseMove])

  const startResizingLeft = useCallback((e) => {
    e.preventDefault()
    isResizingLeft.current = true
    document.addEventListener('mousemove', handleLeftMouseMove)
    document.addEventListener('mouseup', handleLeftMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [handleLeftMouseMove, handleLeftMouseUp])

  // ── Emulator panel resize ────────────────────────────────────────────────
  const isResizingEmu = useRef(false)

  const handleEmuMouseMove = useCallback((e) => {
    if (!isResizingEmu.current) return
    const newWidth = window.innerWidth - e.clientX
    if (newWidth > 320 && newWidth < 900) {
      setEmuPanelWidth(newWidth)
    }
  }, [])

  const handleEmuMouseUp = useCallback(() => {
    isResizingEmu.current = false
    document.removeEventListener('mousemove', handleEmuMouseMove)
    document.removeEventListener('mouseup', handleEmuMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [handleEmuMouseMove])

  const startResizingEmu = useCallback((e) => {
    e.preventDefault()
    isResizingEmu.current = true
    document.addEventListener('mousemove', handleEmuMouseMove)
    document.addEventListener('mouseup', handleEmuMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [handleEmuMouseMove, handleEmuMouseUp])

  const scrollBottom = () => {
    const container = msgEndRef.current?.parentElement
    if (!container) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
    if (isNearBottom) {
      msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }
  useEffect(scrollBottom, [messages])

  useEffect(() => {
    if (!loading) {
      setElapsedTime(0)
      return
    }
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsedTime(Date.now() - start)
    }, 100)
    return () => clearInterval(timer)
  }, [loading])

  const fetchHistory = useCallback(async () => {
    if (!user?.token) return
    try {
      const res = await fetch(`${chatbotApi}/chat`, { 
        headers: { Authorization: `Bearer ${user.token}` } 
      })
      if (res.ok) {
        const data = await res.json()
        setChatHistory(Array.isArray(data) ? data : data.chats || [])
      }
    } catch (err) {
      console.error('Failed to fetch chat history', err)
    }
  }, [chatbotApi, user])

  // Load chat history from chatbot service
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const loadChat = async (chatId) => {
    setActiveChatId(chatId)
    try {
      const res = await fetch(`${chatbotApi}/chat/${chatId}`, { headers: { Authorization: `Bearer ${user?.token}` } })
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages.map(m => ({ 
          role: m.role === 'model' ? 'assistant' : m.role, 
          text: m.content,
          agentSteps: m.agentSteps || []
        })))
      }
    } catch {}
  }

  const newChat = () => { setMessages([]); setActiveChatId(null); setAgentResult(null) }

  const deleteChatHistory = async (chatId, e) => {
    e.stopPropagation()
    if (!window.confirm("Are you sure you want to delete this chat history?")) return
    try {
      const res = await fetch(`${chatbotApi}/chat/${chatId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user?.token}` }
      })
      if (res.ok) {
        if (activeChatId === chatId) {
          newChat()
        }
        fetchHistory()
      } else {
        console.error("Failed to delete chat")
      }
    } catch (err) {
      console.error("Error deleting chat:", err)
    }
  }

  useEffect(() => {
    const hint = sessionStorage.getItem('agent_array_hint')
    if (hint) setArrayHint(hint)
    const prefill = sessionStorage.getItem('agent_prefill_query')
    if (prefill) {
      sessionStorage.removeItem('agent_prefill_query')
      setAiMode('agent')
      setTimeout(() => sendMessage(prefill), 300)
    }
  }, [])

  const stopGeneration = useCallback(async () => {
    if (!currentRequestId) return
    try {
      await fetch(`${apiBase}/api/chat/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: currentRequestId })
      })
    } catch(e) {}
    if (activeEsRef.current) activeEsRef.current.close()
    if (activeReaderRef.current) {
      try { activeReaderRef.current.cancel() } catch(e) {}
    }
    setLoading(false)
    setMessages(prev => {
      const updated = [...prev]
      if (updated.length > 0) {
        const last = updated[updated.length - 1]
        if (last && last.isStreaming) {
          last.isStreaming = false
          last.text += '\n\n*Stream generation cancelled.*'
        }
      }
      return updated
    })
  }, [currentRequestId, apiBase])

  useEffect(() => {
    if (!loading) {
      setPendingCommand(null)
      return
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/terminal/pending`)
        if (res.ok) {
          const data = await res.json()
          if (data.command) {
            setPendingCommand(data)
          } else {
            setPendingCommand(null)
          }
        }
      } catch (err) {}
    }, 1000)
    return () => clearInterval(interval)
  }, [loading, apiBase])

  const fetchActiveWindows = useCallback(async () => {
    setLoadingWindows(true)
    try {
      const res = await fetch(`${apiBase}/api/terminal/windows`)
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setActiveWindows(data.windows)
        }
      }
    } catch (e) {
      console.error("Failed to fetch active windows:", e)
    } finally {
      setLoadingWindows(false)
    }
  }, [apiBase])

  const handleTerminalApproval = async (decision, modifiedCommand) => {
    try {
      await fetch(`${apiBase}/api/terminal/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, modifiedCommand })
      })
      setPendingCommand(null)
    } catch(e) {}
  }

  const handleTerminalConnect = async (type, mode, host, username, password, hwnd) => {
    // Only 'simulated' (Emulator Gateway) is supported now
    setTerminalType('simulated')
    setTerminalMode(mode)
    setShowConnectModal(false)
    setShowTerminalPanel(true)
  }

  // ── Emulator Gateway logic (mirrors EmulatorPage) ─────────────────────────
  useEffect(() => {
    fetch(`${apiBase}/api/sim/devices`).then(r => r.json())
      .then(d => {
        const list = d.devices || d
        setEmuDevices(Array.isArray(list) ? list : [])
      }).catch(() => {})
  }, [apiBase])

  useEffect(() => {
    if (emuTermBodyRef.current) {
      emuTermBodyRef.current.scrollTop = emuTermBodyRef.current.scrollHeight
    }
  }, [emuHistory, emuInput, emuPrompt])

  useEffect(() => {
    if (showTerminalPanel) emuInputRef.current?.focus()
  }, [emuSshState, showTerminalPanel])

  const emuAddLine = useCallback((type, text) =>
    setEmuHistory(prev => [...prev, { type, text }]), [])

  const emuStartSSHHandshake = useCallback(async (user, ip, originalCmd) => {
    emuAddLine('cmd', `${emuSshState === 'connected' ? emuPrompt : 'console-gateway$ '}${originalCmd}`)
    setEmuLoading(true)
    const foundDev = emuDevices.find(d => d.ip === ip)
    if (!foundDev) {
      emuAddLine('error', `ssh: Could not resolve hostname ${ip}: Name or service not known`)
      setEmuPrompt('console-gateway$ ')
      setEmuSshState('disconnected')
      setEmuLoading(false)
      return
    }
    try {
      const res = await fetch(`${apiBase}/api/sim/ssh/connect/${ip}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEmuHandshake(data)
      setEmuActiveDevice(foundDev)
      if (data.key_type) {
        emuAddLine('warn', `Warning: the ${data.key_type} host key for '${data.name || ip}' differs from key for IP '${ip}'`)
        setEmuPrompt('Are you sure you want to continue connecting (yes/no)? ')
        setEmuSshState('awaiting_yes_no')
      } else {
        setEmuPrompt(data.password_prompt || 'Password: ')
        setEmuSshState('awaiting_password')
      }
    } catch (err) {
      emuAddLine('error', `Bypassing SSH simulation: ${err.message}`)
      setEmuPrompt(`${foundDev?.name || ip}# `)
      setEmuActiveDevice(foundDev)
      setEmuSshState('connected')
    } finally {
      setEmuLoading(false)
    }
  }, [apiBase, emuDevices, emuPrompt, emuSshState, emuAddLine])

  const emuHandleSidebarClick = useCallback(async (device) => {
    const user = emuGetSSHUser(device)
    const ip = device.ip
    if (emuSshState === 'connected' && emuActiveDevice?.ip === ip) {
      emuAddLine('info', `Already connected to ${device.name || ip}`)
      return
    }
    if (emuSshState === 'connected') {
      emuAddLine('info', `Connection to ${emuActiveDevice?.name || emuActiveDevice?.ip} closed.`)
    }
    setEmuSshState('disconnected')
    setEmuInput('')
    await emuStartSSHHandshake(user, ip, `ssh ${user}@${ip}`)
  }, [emuSshState, emuActiveDevice, emuAddLine, emuStartSSHHandshake])

  const emuRunQuickCommand = useCallback(async (cmd) => {
    if (emuSshState !== 'connected' || emuLoading) return
    emuAddLine('cmd', `${emuPrompt}${cmd}`)
    setEmuLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/sim/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: emuActiveDevice?.ip, command: cmd })
      })
      const data = await res.json()
      const output = data.output || data.error || 'No output'
      output.split('\n').forEach(line => emuAddLine('out', line))
      emuAddLine('out', '')
    } catch (err) {
      emuAddLine('error', `Connection error: ${err.message}`)
    } finally {
      setEmuLoading(false)
    }
  }, [apiBase, emuActiveDevice, emuLoading, emuPrompt, emuSshState, emuAddLine])

  const emuHandleKeyDown = useCallback(async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = emuInput.trim()
      const currentVal = emuInput
      setEmuInput('')
      if (trimmed === 'clear') { setEmuHistory([]); return }
      try {
        if (emuSshState === 'disconnected') {
          if (!trimmed) { emuAddLine('cmd', emuPrompt); return }
          if (trimmed.startsWith('ssh ')) {
            const parts = trimmed.substring(4).split('@')
            let user = 'root', ip = ''
            if (parts.length === 2) { user = parts[0]; ip = parts[1] } else { ip = parts[0] }
            await emuStartSSHHandshake(user, ip, trimmed)
          } else {
            emuAddLine('cmd', `${emuPrompt}${trimmed}`)
            emuAddLine('error', 'Not connected. Use "ssh <user>@<ip>" or click a device.')
          }
          return
        }
        if (emuSshState === 'awaiting_yes_no') {
          emuAddLine('cmd', `${emuPrompt}${currentVal}`)
          if (trimmed.toLowerCase() === 'yes') {
            setEmuPrompt(emuHandshake?.password_prompt || 'Password: ')
            setEmuSshState('awaiting_password')
          } else if (trimmed.toLowerCase() === 'no') {
            emuAddLine('error', 'Host key verification failed. Connection closed.')
            setEmuPrompt('console-gateway$ ')
            setEmuSshState('disconnected')
            setEmuActiveDevice(null)
          } else { emuAddLine('error', "Please type 'yes' or 'no'.") }
          return
        }
        if (emuSshState === 'awaiting_password') {
          emuAddLine('cmd', `${emuPrompt}`)
          const devName = emuHandshake?.name || emuActiveDevice?.name || emuActiveDevice?.ip || 'device'
          const devKind = emuGetDeviceKind(emuActiveDevice)
          if (devKind === 'switch') {
            emuAddLine('out', `${devName}:FID100:admin> `)
            setEmuPrompt(`${devName}:FID100:admin> `)
          } else if (devKind === 'array') {
            emuAddLine('out', `root@${devName}:~# `)
            setEmuPrompt(`root@${devName}:~# `)
          } else {
            emuAddLine('info', `Linux ${devName} — logged in`)
            setEmuPrompt(`root@${devName}:~$ `)
          }
          setEmuSshState('connected')
          return
        }
        if (emuSshState === 'connected') {
          if (!trimmed) { emuAddLine('cmd', emuPrompt); return }
          emuAddLine('cmd', `${emuPrompt}${trimmed}`)
          if (trimmed === 'exit' || trimmed === 'logout') {
            emuAddLine('info', `Connection to ${emuActiveDevice?.name || emuActiveDevice?.ip} closed.`)
            setEmuPrompt('console-gateway$ ')
            setEmuSshState('disconnected')
            setEmuActiveDevice(null)
            return
          }
          setEmuCmdHistory(prev => [trimmed, ...prev.slice(0, 49)])
          setEmuHistIdx(-1)
          setEmuLoading(true)
          try {
            const res = await fetch(`${apiBase}/api/sim/exec`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ip: emuActiveDevice?.ip, command: trimmed })
            })
            const data = await res.json()
            const output = data.output || data.error || 'No output'
            output.split('\n').forEach(line => emuAddLine('out', line))
            emuAddLine('out', '')
          } catch (err) {
            emuAddLine('error', `Connection error: ${err.message}`)
          } finally {
            setEmuLoading(false)
          }
        }
      } catch (err) {
        emuAddLine('error', `Internal console error: ${err.message}`)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (emuSshState !== 'connected') return
      const newIdx = Math.min(emuHistIdx + 1, emuCmdHistory.length - 1)
      setEmuHistIdx(newIdx)
      setEmuInput(emuCmdHistory[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (emuSshState !== 'connected') return
      const newIdx = Math.max(emuHistIdx - 1, -1)
      setEmuHistIdx(newIdx)
      setEmuInput(newIdx === -1 ? '' : emuCmdHistory[newIdx] || '')
    }
  }, [apiBase, emuInput, emuSshState, emuPrompt, emuHandshake, emuActiveDevice, emuHistIdx, emuCmdHistory, emuAddLine, emuStartSSHHandshake])

  // ── Agent → Emulator automation: when arrayHint changes, glow the device ──
  useEffect(() => {
    if (!arrayHint || !emuDevices.length) return
    const match = emuDevices.find(d =>
      (d.name || '').toLowerCase().includes(arrayHint.toLowerCase()) ||
      (d.ip || '').includes(arrayHint)
    )
    if (match) {
      setHighlightedDevice(match.ip)
      setTimeout(() => setHighlightedDevice(null), 2800)
    }
  }, [arrayHint, emuDevices])

  // ── Stable refs for emulator state (avoid stale closures in sendMessage) ──
  const emuDevicesRef = useRef(emuDevices)
  useEffect(() => { emuDevicesRef.current = emuDevices }, [emuDevices])
  const emuActiveDeviceRef = useRef(emuActiveDevice)
  useEffect(() => { emuActiveDeviceRef.current = emuActiveDevice }, [emuActiveDevice])
  const emuSshStateRef = useRef(emuSshState)
  useEffect(() => { emuSshStateRef.current = emuSshState }, [emuSshState])
  const emuPromptRef = useRef(emuPrompt)
  useEffect(() => { emuPromptRef.current = emuPrompt }, [emuPrompt])
  const showTerminalPanelRef = useRef(showTerminalPanel)
  useEffect(() => { showTerminalPanelRef.current = showTerminalPanel }, [showTerminalPanel])

  // Queue to run emulator commands sequentially
  const emuCommandQueueRef = useRef(Promise.resolve())

  // Set to track unique step IDs seen during the current Agent query
  const seenStepIdsRef = useRef(new Set())

  // Ref to hold the active backend LLM polling interval
  const pollIntervalRef = useRef(null)

  // emuExecuteAgentCommand: auto-SSH + typewriter-animate + execute in emulator panel
  // Stored in a ref so sendMessage's useCallback can call it without stale closure.
  const emuExecuteAgentCommandRef = useRef(null)
  useEffect(() => {
    emuExecuteAgentCommandRef.current = async (targetName, command) => {
      if (!showTerminalPanelRef.current) return

      const devices = emuDevicesRef.current
      const device = devices.find(d =>
        (d.name || '').toLowerCase().includes(targetName.toLowerCase()) ||
        targetName.toLowerCase().includes((d.name || '').toLowerCase()) ||
        (d.ip || '') === targetName
      )
      if (!device) {
        setEmuHistory(prev => [...prev, { type: 'warn', text: `# [Agent] Device "${targetName}" not found in emulator` }])
        return
      }

      // Glow the device card
      setHighlightedDevice(device.ip)
      setTimeout(() => setHighlightedDevice(null), 2800)

      const user = emuGetSSHUser(device)
      const ip = device.ip
      const devName = device.name || ip
      const devKind = emuGetDeviceKind(device)
      const isConnected = emuActiveDeviceRef.current?.ip === ip && emuSshStateRef.current === 'connected'

      // Compute prompts
      const newPrompt = devKind === 'switch'
        ? `${devName}:FID100:admin> `
        : devKind === 'array'
        ? `root@${devName}:~# `
        : `root@${devName}:~$ `
      const activePrompt = isConnected ? emuPromptRef.current : newPrompt

      if (!isConnected) {
        // — Animate SSH command typing —
        const sshCmd = `ssh ${user}@${ip}`
        setEmuHistory(prev => [...prev, { type: 'info', text: `# [Agent] Auto-connecting to ${devName}...` }])
        for (let i = 1; i <= sshCmd.length; i++) {
          setEmuInput(sshCmd.substring(0, i))
          await new Promise(r => setTimeout(r, 38))
        }
        await new Promise(r => setTimeout(r, 220))
        setEmuInput('')
        setEmuHistory(prev => [...prev, { type: 'cmd', text: `console-gateway$ ${sshCmd}` }])
        await new Promise(r => setTimeout(r, 280))

        // — Host key warning —
        setEmuHistory(prev => [...prev,
          { type: 'warn', text: `Warning: the ECDSA host key for '${devName}' differs from key for IP '${ip}'` },
          { type: 'out', text: '' }
        ])
        setEmuPrompt('Are you sure you want to continue connecting (yes/no)? ')
        setEmuSshState('awaiting_yes_no')
        await new Promise(r => setTimeout(r, 320))

        // — Auto-type "yes" —
        for (let i = 1; i <= 3; i++) {
          setEmuInput('yes'.substring(0, i))
          await new Promise(r => setTimeout(r, 85))
        }
        await new Promise(r => setTimeout(r, 260))
        setEmuInput('')
        setEmuHistory(prev => [...prev, { type: 'cmd', text: 'Are you sure you want to continue connecting (yes/no)? yes' }])

        // — Password prompt (hidden) —
        const passPrompt = `${user}@${ip}'s password: `
        setEmuPrompt(passPrompt)
        setEmuSshState('awaiting_password')
        setEmuHistory(prev => [...prev, { type: 'out', text: passPrompt }])
        
        await new Promise(r => setTimeout(r, 150))
        const typedPassword = window.prompt(`[HPE Terminal Gateway] Enter password for ${user}@${ip}:`, "") || "root"
        
        const dots = "•".repeat(Math.min(typedPassword.length || 6, 8))
        for (let i = 1; i <= dots.length; i++) {
          setEmuInput(dots.substring(0, i))
          await new Promise(r => setTimeout(r, 60))
        }
        await new Promise(r => setTimeout(r, 220))
        setEmuInput('')
        setEmuHistory(prev => [...prev, { type: 'cmd', text: `${passPrompt}` }])
        await new Promise(r => setTimeout(r, 180))

        // — Login banner —
        const loginLine = devKind === 'switch' ? `${devName}:FID100:admin> ` : `root@${devName}:~# `
        setEmuHistory(prev => [...prev, { type: 'out', text: loginLine }])
        setEmuActiveDevice(device)
        setEmuSshState('connected')
        setEmuPrompt(newPrompt)
        emuActiveDeviceRef.current = device
        emuSshStateRef.current = 'connected'
        emuPromptRef.current = newPrompt
        await new Promise(r => setTimeout(r, 300))
      }

      // — Typewriter-animate the command —
      for (let i = 1; i <= command.length; i++) {
        setEmuInput(command.substring(0, i))
        await new Promise(r => setTimeout(r, 32))
      }
      await new Promise(r => setTimeout(r, 180))
      setEmuInput('')
      setEmuHistory(prev => [...prev, { type: 'cmd', text: `${activePrompt}${command}` }])
      setEmuLoading(true)

      // — Execute via simulator API —
      try {
        const res = await fetch(`${apiBase}/api/sim/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip, command })
        })
        const data = await res.json()
        const output = data.output || data.error || 'No output'
        output.split('\n').forEach(line =>
          setEmuHistory(prev => [...prev, { type: 'out', text: line }])
        )
        setEmuHistory(prev => [...prev, { type: 'out', text: '' }])
        return output
      } catch (err) {
        setEmuHistory(prev => [...prev, { type: 'error', text: `Error: ${err.message}` }])
        return `Error: ${err.message}`
      } finally {
        setEmuLoading(false)
      }
    }
  }, [apiBase]) // apiBase is stable; all other deps read through refs

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    setInput('')
    setLastQuery(trimmed)
    setMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setLoading(true)
    setLlmCallsCount(0)
    seenStepIdsRef.current = new Set()

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    // Reset actual backend counter in Python
    try {
      fetch(`${apiBase}/api/llm/calls/reset`, { method: 'POST' }).catch(() => {})
    } catch (e) {}

    // Poll actual Groq API calls count dynamically from backend
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/llm/calls`)
        const data = await res.json()
        if (typeof data.count === 'number') {
          setLlmCallsCount(data.count)
        }
      } catch (err) {}
    }, 350)

    if (aiMode === 'agent') {
      setAgentResult(null)
      emuCommandQueueRef.current = Promise.resolve()
    }

    const reqId = 'req-' + Date.now()
    setCurrentRequestId(reqId)

    try {
      let answer = ''
      if (aiMode === 'agent') {
        setSidebarVisible(true)
        
        // Add a placeholder message for the assistant that will be populated as steps stream in
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: '### Starting HPE SAN Agent...\nPreparing connection protocols...',
          agentSteps: [],
          isAgent: true,
          isStreaming: true,
        }])

        setAgentResult({ steps: [] })

        const qParam = encodeURIComponent(trimmed)
        const aParam = encodeURIComponent(arrayHint || '')
        const ollamaParam = useOllama ? 'true' : 'false'
        const thinkParam = disableThink ? 'true' : 'false'
        const es = new EventSource(`${apiBase}/api/agent/run/stream?query=${qParam}&array=${aParam}&useOllama=${ollamaParam}&disableThink=${thinkParam}&requestId=${reqId}&ollamaModel=${encodeURIComponent(ollamaModel)}`)
        activeEsRef.current = es

        es.onmessage = (e) => {
          const event = JSON.parse(e.data)
          if (event.type === 'step') {
            const step = event.step
            const title = step.title || ''
            const runMatch = title.match(/^ran command on (.+)$/i)

            const updateVisualSteps = () => {
              setAgentResult(prev => {
                const steps = prev?.steps || []
                if (steps.some(s => s.id === step.id)) return prev
                return { ...(prev || {}), steps: [...steps, step] }
              })
              setMessages(prev => {
                if (prev.length === 0) return prev
                const last = prev[prev.length - 1]
                if (last && last.role === 'assistant') {
                  const currentSteps = last.agentSteps || []
                  if (currentSteps.some(s => s.id === step.id)) return prev
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      agentSteps: [...currentSteps, step],
                      text: `### Running Diagnostics...\nCurrently planning: **${step.title}**\n\n*${step.detail || ''}*`
                    }
                  ]
                }
                return prev
              })

            }

            if (emuExecuteAgentCommandRef.current && showTerminalPanelRef.current) {
              if (runMatch && step.detail) {
                // Queue command execution + terminal playback
                emuCommandQueueRef.current = emuCommandQueueRef.current.then(async () => {
                  updateVisualSteps()
                  const realOutput = await emuExecuteAgentCommandRef.current(runMatch[1].trim(), step.detail.trim())
                  
                  // Enhance the step object dynamically with real output from Emulator Gateway
                  const updatedStep = {
                    ...step,
                    type: 'command', // Force step type to 'command' so the dropdown renders in AgentStepTimeline
                    command: step.detail.trim(),
                    command_output: realOutput || 'No output'
                  }

                  setAgentResult(prev => {
                    const steps = prev?.steps || []
                    return {
                      ...(prev || {}),
                      steps: steps.map(s => s.id === step.id ? updatedStep : s)
                    }
                  })

                  setMessages(prev => {
                    if (prev.length === 0) return prev
                    const last = prev[prev.length - 1]
                    if (last && last.role === 'assistant') {
                      const currentSteps = last.agentSteps || []
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...last,
                          agentSteps: currentSteps.map(s => s.id === step.id ? updatedStep : s)
                        }
                      ]
                    }
                    return prev
                  })
                })
              } else {
                // Queue non-command steps sequentially with a short delay to simulate real-time API execution
                emuCommandQueueRef.current = emuCommandQueueRef.current.then(async () => {
                  updateVisualSteps()
                  
                  if (/^thinking$/i.test(title.trim()) && step.detail) {
                    // Show thinking bullet as comment banner in terminal immediately during playback
                    setEmuHistory(prev => [
                      ...prev,
                      { type: 'ssh', text: '# ──────────────────────────────────────' },
                      { type: 'ssh', text: `# 🧠 Agent Thinking` },
                      ...step.detail.split('\n').filter(l => l.trim()).map(l => ({ type: 'ssh', text: `#  ${l}` })),
                      { type: 'ssh', text: '# ──────────────────────────────────────' },
                    ])
                  }
                  
                  // Natural pace delay for non-command actions (thinking/database updates)
                  await new Promise(r => setTimeout(r, 650))
                })
              }
            } else {
              // Standard path if terminal mirror is closed: render immediately
              updateVisualSteps()
            }
          } else if (event.type === 'synthesis') {
            const token = event.content
            const isThink = event.is_think
            
            setMessages(prev => {
              if (prev.length === 0) return prev
              const last = prev[prev.length - 1]
              if (last && last.role === 'assistant') {
                const isFirstToken = !last.isStreamingSynthesis
                let newText = isFirstToken ? '' : last.text
                
                if (isThink) {
                  if (!newText.includes('<think>')) {
                    newText = '<think>' + newText
                  }
                } else {
                  if (newText.includes('<think>') && !newText.includes('</think>')) {
                    newText += '</think>\n\n'
                  }
                }
                newText += token
                
                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    isStreamingSynthesis: true,
                    text: newText
                  }
                ]
              }
              return prev
            })
          } else if (event.type === 'final') {
            const data = event.result

            const handleFinalize = () => {
              setLlmCallsCount(prev => prev + 1) // Final response summary is a real LLM call
              setAgentResult(data)
              let textToSave = data.answer || 'Agent completed successfully.'
              setMessages(prev => {
                if (prev.length === 0) return prev
                const last = prev[prev.length - 1]
                if (last && last.role === 'assistant') {
                  let finalAnswer = data.answer || 'Agent completed successfully.'
                  if (last.text && last.text.includes('<think>')) {
                    const match = last.text.match(/<think>([\s\S]*?)(?:<\/think>)?/)
                    if (match) {
                      const thinkContent = match[1].trim()
                      finalAnswer = `<think>\n${thinkContent}\n</think>\n\n${data.answer || ''}`
                    }
                  }
                  textToSave = finalAnswer
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      agentSteps: data.steps,
                      text: finalAnswer,
                      isStreaming: false
                    }
                  ]
                }
                return prev
              })
              setLoading(false)
              es.close()

              // SAVE AGENT CHAT TO MONGODB HISTORY
              try {
                fetch(`${chatbotApi}/chat/message`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
                  body: JSON.stringify({
                    message: trimmed,
                    chatId: activeChatId || undefined,
                    customResponse: textToSave,
                    agentSteps: data.steps || []
                  })
                }).then(res => res.json()).then(saveData => {
                  if (saveData.chatId && !activeChatId) {
                    setActiveChatId(saveData.chatId)
                    fetchHistory() // Refresh sidebar
                  }
                }).catch(err => console.error("Failed to save Agent chat to history:", err))
              } catch (saveErr) {
                console.error("Failed to save Agent chat to history:", saveErr)
              }
            }

            if (emuExecuteAgentCommandRef.current && showTerminalPanelRef.current) {
              // Wait for all queued commands to finish before final display
              emuCommandQueueRef.current = emuCommandQueueRef.current.then(() => {
                handleFinalize()
              })
            } else {
              handleFinalize()
            }
          } else if (event.type === 'error') {
            const errStr = event.error || 'An unexpected error occurred.'
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last && last.role === 'assistant') {
                last.text = `### Agent Error ❌\n\n${errStr}`
                last.isStreaming = false
              }
              return updated
            })
            setLoading(false)
            es.close()
          }
        }

        es.onerror = () => {
          setMessages(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant') {
              last.text = `### Connection Timeout ⚠️\nThe agent connection was interrupted. Please retry your query.`
              last.isStreaming = false
            }
            return updated
          })
          setLoading(false)
          es.close()
        }
        return
      }

      if (aiMode === 'graphrag' || aiMode === 'standard') {
        // SSE Streaming for Ollama / Groq RAG Engine
        setMessages(prev => [...prev, { role: 'assistant', text: '', isStreaming: true, isOllama: useOllama }])
        setLlmCallsCount(prev => prev + 1)
        
        try {
          const res = await fetch(`${apiBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              query: trimmed, 
              useOllama, 
              disableThink, 
              stream: true,
              mode: aiMode,
              requestId: reqId,
              history: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.text }))
            })
          })
          
          if (!res.ok) throw new Error('Network response was not ok')
          
          const reader = res.body.getReader()
          activeReaderRef.current = reader
          const decoder = new TextDecoder()
          let fullText = ''
          
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n\n')
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))
                   if (data.type === 'chunk' || data.type === 'think') {
                    // Prepend <think> if this is a think chunk and we don't have it yet
                    const content = data.content
                    if (data.type === 'think') {
                      if (!fullText.includes('<think>')) {
                        fullText = '<think>' + fullText
                      }
                    } else if (data.type === 'chunk') {
                      // Close the think block if it was open
                      if (fullText.includes('<think>') && !fullText.includes('</think>')) {
                        fullText += '</think>\n\n'
                      }
                    }
                    fullText += content
                    setMessages(prev => {
                      const newMsgs = [...prev]
                      newMsgs[newMsgs.length - 1].text = fullText
                      return newMsgs
                    })
                  } else if (data.type === 'final') {
                    const finalResult = data.result
                    let finalText = fullText
                    if (finalResult.cypher) {
                      finalText += `\n\n**Neo4j Cypher Query:**\n\`\`\`cypher\n${finalResult.cypher}\n\`\`\``
                    }
                    setMessages(prev => {
                      const newMsgs = [...prev]
                      newMsgs[newMsgs.length - 1].text = finalText
                      newMsgs[newMsgs.length - 1].isStreaming = false
                      return newMsgs
                    })
                    
                    try {
                      const saveRes = await fetch(`${chatbotApi}/chat/message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
                        body: JSON.stringify({
                          message: trimmed,
                          chatId: activeChatId || undefined,
                          customResponse: finalText
                        })
                      })
                      const saveData = await saveRes.json()
                      if (saveData.chatId && !activeChatId) {
                        setActiveChatId(saveData.chatId)
                        fetchHistory()
                      }
                    } catch (saveErr) {}
                  }
                } catch (e) {}
              }
            }
          }
        } catch (err) {
          console.error(err)
        }
      } else if (aiMode === 'graphrag') {
        // GraphRAG mode — uses Flask backend's Groq+Neo4j RAG engine
        setLlmCallsCount(prev => prev + 1)
        const res = await fetch(`${apiBase}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed })
        })
        const data = await res.json()
        let answer = data.answer || data.response || 'No response from GraphRAG engine.'
        
        // Append Cypher query if available so it's displayed in the UI
        if (data.cypher) {
          answer += `\n\n**Neo4j Cypher Query:**\n\`\`\`cypher\n${data.cypher}\n\`\`\``
        }

        // SAVE GRAPHRAG CHAT TO MONGODB HISTORY!
        try {
          const saveRes = await fetch(`${chatbotApi}/chat/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
            body: JSON.stringify({
              message: trimmed,
              chatId: activeChatId || undefined,
              customResponse: answer
            })
          })
          const saveData = await saveRes.json()
          if (saveData.chatId && !activeChatId) {
            setActiveChatId(saveData.chatId)
            fetchHistory() // Refresh sidebar to show the new chat entry
          }
        } catch (saveErr) {
          console.error("Failed to save GraphRAG chat to history:", saveErr)
        }
        setMessages(prev => [...prev, { role: 'assistant', text: answer }])
      } else {
        // Standard mode — uses chatbot service's Gemini AI with SAN context
        const res = await fetch(`${chatbotApi}/chat/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
          body: JSON.stringify({
            message: trimmed,
            chatId: activeChatId || undefined,
            history: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.text }))
          })
        })
        const data = await res.json()
        let answer = data.response || data.message || data.answer || (data.messages ? data.messages[data.messages.length - 1].content : 'No response from AI.')
        
        if (data.chatId && !activeChatId) {
          setActiveChatId(data.chatId)
          fetchHistory() // Refresh sidebar to show the new chat entry
        }
        setMessages(prev => [...prev, { role: 'assistant', text: answer }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}. Make sure the backend is running.` }])
    } finally {
      setLoading(false)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      // Final fetch to synchronize the exact counter state
      setTimeout(async () => {
        try {
          const res = await fetch(`${apiBase}/api/llm/calls`)
          const data = await res.json()
          if (typeof data.count === 'number') {
            setLlmCallsCount(data.count)
          }
        } catch (e) {}
      }, 300)
    }
  }, [input, loading, aiMode, apiBase, chatbotApi, user, messages, activeChatId, arrayHint])

  // ── LLM Log Ingest Handler ────────────────────────────────────────────────
  const startLLMIngest = useCallback(async (file) => {
    if (!file) return

    const msgId = 'llm-ingest-' + Date.now()

    const userMsg = {
      role: 'user',
      text: `Uploaded log file for LLM parsing: **${file.name}**`
    }
    const assistantMsg = {
      id: msgId,
      role: 'assistant',
      isLLMIngest: true,
      llmIngestFile: file,
      llmIngestPhase: 'running',
      llmIngestLogs: [],
      llmIngestChunks: [],
      llmIngestResult: null,
      llmIngestError: null,
      llmIngestStep: 0
    }

    setLlmCallsCount(0)
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    try {
      fetch(`${apiBase}/api/llm/calls/reset`, { method: 'POST' }).catch(() => {})
    } catch (e) {}

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/llm/calls`)
        const data = await res.json()
        if (typeof data.count === 'number') {
          setLlmCallsCount(data.count)
        }
      } catch (err) {}
    }, 350)

    setMessages(prev => [...prev, userMsg, assistantMsg])

    const addLog = (msgText, type = 'info') => {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, llmIngestLogs: [...(m.llmIngestLogs || []), { msg: msgText, type, ts }] } : m
      ))
    }

    const setStep = (stepVal) =>
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, llmIngestStep: stepVal } : m))

    const setPhase = (phaseVal) =>
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, llmIngestPhase: phaseVal } : m))

    const setResult = (resultVal) =>
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, llmIngestResult: resultVal } : m))

    const setError = (errorVal) =>
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, llmIngestError: errorVal } : m))

    // Add a new LLM chunk panel to the card
    const addChunk = (idx, total) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        const existing = m.llmIngestChunks || []
        if (existing.some(c => c.idx === idx)) return m
        return { ...m, llmIngestChunks: [...existing, { idx, total, thinking: '', content: '', phase: 'running' }] }
      }))
    }

    // Append a streaming token to a chunk's thinking or content field
    const appendToChunk = (idx, field, text) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        return {
          ...m,
          llmIngestChunks: (m.llmIngestChunks || []).map(c =>
            c.idx === idx ? { ...c, [field]: (c[field] || '') + text } : c
          )
        }
      }))
    }

    // Mark a chunk as done
    const completeChunk = (idx) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        return {
          ...m,
          llmIngestChunks: (m.llmIngestChunks || []).map(c =>
            c.idx === idx ? { ...c, phase: 'done' } : c
          )
        }
      }))
    }

    addLog(`Starting LLM ingest for: ${file.name}`, 'system')

    // Track which chunk index is currently streaming
    let currentChunkIdx = null

    try {
      const formData = new FormData()
      formData.append('file', file)

      const snapshotLabel = encodeURIComponent(`✨ LLM Ingest: ${file.name}`)
      const ollamaParam = useOllama ? 'true' : 'false'
      const res = await fetch(
        `${apiBase}/api/ingest/log/ai?label=${snapshotLabel}&useOllama=${ollamaParam}`,
        { method: 'POST', body: formData }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'progress') {
              addLog(event.msg, 'progress')
              const msg = (event.msg || '').toLowerCase()
              if (msg.includes('backup')) setStep(0)
              else if (msg.includes('llm') || msg.includes('chunk') || msg.includes('wip')) setStep(1)
              else if (msg.includes('popul') || msg.includes('databas')) setStep(2)
              else if (msg.includes('snapshot')) setStep(3)
            } else if (event.type === 'warning') {
              addLog(event.msg, 'warn')
            } else if (event.type === 'llm_start') {
              // Open a new chunk panel on the card
              currentChunkIdx = event.chunk_idx
              addChunk(event.chunk_idx, event.total_chunks)
              setStep(1)
            } else if (event.type === 'think') {
              // Route to the right chunk's thinking field
              if (currentChunkIdx !== null) appendToChunk(currentChunkIdx, 'thinking', event.content)
            } else if (event.type === 'chunk') {
              // Route to the right chunk's content field
              if (currentChunkIdx !== null) appendToChunk(currentChunkIdx, 'content', event.content)
            } else if (event.type === 'llm_done') {
              if (event.chunk_idx !== null) completeChunk(event.chunk_idx)
            } else if (event.type === 'final') {
              setStep(4)
              setResult(event)
              setPhase('done')
              addLog(`Done! Parsed ${event.arrays_parsed ?? 0} array(s).`, 'success')
              if (event.snapshot_id) addLog(`Snapshot saved: ${event.snapshot_id}`, 'success')
            }
          } catch (parseErr) {
            // ignore malformed SSE line
          }
        }
      }
    } catch (err) {
      addLog(`Error: ${err.message}`, 'error')
      setError(err.message)
      setPhase('error')
    } finally {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      // Final fetch to synchronize the exact counter state
      setTimeout(async () => {
        try {
          const res = await fetch(`${apiBase}/api/llm/calls`)
          const data = await res.json()
          if (typeof data.count === 'number') {
            setLlmCallsCount(data.count)
          }
        } catch (e) {}
      }, 300)
    }
  }, [apiBase, useOllama])

  const handleLLMFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) startLLMIngest(file)
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }

  const handleInputChange = (e) => {
    setInput(e.target.value)
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }

  useEffect(() => {
    if (input === '' && inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [input])

  const filteredHistory = chatHistory.filter(c =>
    (c.title || 'New Chat').toLowerCase().includes(sidebarSearch.toLowerCase())
  )

  const handleRootMouseDown = (e) => {
    if (e.button === 1) { // Middle click
      e.preventDefault()
      setRadialPos({ x: e.clientX, y: e.clientY })
    } else if (radialPos) {
      setRadialPos(null)
    }
  }

  return (
    <div 
      style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}
      onMouseDown={handleRootMouseDown}
    >
      {/* Hidden file input for LLM ingest */}
      <input
        ref={llmFileRef}
        type="file"
        accept=".txt,.log,.json"
        style={{ display: 'none' }}
        onChange={handleLLMFileChange}
      />

      {/* Radial Menu Popup */}
      {radialPos && (
        <div 
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: radialPos.y,
            left: radialPos.x,
            transform: 'translate(-50%, -50%)',
            zIndex: 9999
          }}
        >
          <RadialMenu onSend={(text) => {
            sendMessage(text)
            setRadialPos(null)
          }} />
        </div>
      )}

      {/* Knowledge Base / Chat History sidebar — resizable */}
      <div style={{ width: leftSidebarWidth, flexShrink: 0, background: 'var(--surface-1)', borderRight: 'none', display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 180, maxWidth: 520 }}>
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Database size={14} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>Knowledge Base</span>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 12 }} onClick={newChat}>
            <Plus size={14} /> New Chat
          </button>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input className="input" placeholder="Search chats..." value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} style={{ fontSize: 12 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          <div className="section-label" style={{ padding: '8px 8px 4px' }}>Chat Sessions</div>
          {filteredHistory.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>No chats yet</div>}
          {filteredHistory.map(chat => (
            <div
              key={chat._id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                borderRadius: 6,
                background: activeChatId === chat._id ? 'var(--hpe-green-light)' : 'transparent',
                transition: 'all 0.15s',
                marginBottom: 2,
              }}
            >
              <button
                onClick={() => loadChat(chat._id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  padding: '8px 10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: activeChatId === chat._id ? 'var(--hpe-green)' : 'var(--muted)',
                  textAlign: 'left',
                  fontFamily: 'var(--font-sans)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <MessageSquare size={14} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {chat.title || 'New Chat'}
                </span>
              </button>
              <button
                onClick={(e) => deleteChatHistory(chat._id, e)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s',
                }}
                onMouseOver={(e) => e.currentTarget.style.color = 'var(--status-critical)'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--muted)'}
                title="Delete chat"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-main)', fontWeight: 500 }}>Use Local Ollama</span>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <div style={{
                width: 32, height: 18, borderRadius: 9, background: useOllama ? 'var(--hpe-green)' : 'var(--line)',
                position: 'relative', transition: 'background 0.2s'
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: useOllama ? 16 : 2, width: 14, height: 14, borderRadius: 7,
                  background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                }} />
              </div>
              <input type="checkbox" checked={useOllama} onChange={() => setUseOllama(!useOllama)} style={{ display: 'none' }} />
            </label>
          </div>

          {useOllama && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--text-main)' }}>Ollama Model</span>
                <select 
                  className="select" 
                  value={ollamaModel} 
                  onChange={e => setOllamaModel(e.target.value)}
                  style={{ fontSize: 10, padding: '2px 4px', background: 'var(--surface-3)', color: 'var(--text-main)', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer' }}
                >
                  <option value="qwen3:8b">qwen3:8b (Recommended)</option>
                  <option value="qwen3:4b">qwen3:4b</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* ── Left sidebar drag handle ── */}
        <div
          onMouseDown={startResizingLeft}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 5,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 20,
            background: 'transparent',
            transition: 'background 0.2s',
          }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(1,169,130,0.35)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          title="Drag to resize Knowledge Base sidebar"
        />
      </div>

      {/* Left sidebar border line (separate so it doesn't interfere with resize handle) */}
      <div style={{ width: 1, background: 'var(--line)', flexShrink: 0, alignSelf: 'stretch' }} />

      {/* Chat main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Sparkles size={18} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>HPE SAN AI Assistant</span>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {messages.length === 0 && (
            <div style={{ maxWidth: 640, margin: '20px auto', textAlign: 'center' }}>
              <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, color: 'var(--foreground)' }}>
                Hello, {user?.username || 'there'}! 👋
              </h2>
              <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 13, lineHeight: 1.6 }}>
                Use the quick query wheel below or type freely. Click a slice to expand its queries.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <RadialMenu onSend={(text) => sendMessage(text)} />
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.isLLMIngest) {
              return (
                <div key={i} style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-start', gap: 16, flexDirection: 'row' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-main)', border: '1px solid var(--border-color)' }}>
                    <Bot size={16} />
                  </div>
                  <div style={{ flex: 1, maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <LLMIngestCard
                      file={msg.llmIngestFile}
                      phase={msg.llmIngestPhase}
                      step={msg.llmIngestStep}
                      logs={msg.llmIngestLogs}
                      result={msg.llmIngestResult}
                      error={msg.llmIngestError}
                      chunks={msg.llmIngestChunks || []}
                    />
                  </div>
                </div>
              )
            }

            const isUser = msg.role === 'user'
            const hasThinkBlock = msg.text && msg.text.includes('<think>')
            let displayHtml = msg.text || ''
            let thinkText = ''

            if (disableThink) {
              displayHtml = (msg.text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '').trim()
              thinkText = ''
            } else if (hasThinkBlock) {
              const match = msg.text.match(/<think>([\s\S]*?)<\/think>/)
              if (match) {
                thinkText = match[1].trim()
                displayHtml = msg.text.replace(/<think>[\s\S]*?<\/think>/, '').trim()
              } else {
                // Still streaming the think block
                thinkText = msg.text.replace('<think>', '').trim()
                displayHtml = ''
              }
            }

            return (
              <div key={i} style={{ marginBottom: 24, display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 16, flexDirection: isUser ? 'row-reverse' : 'row' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: isUser ? 'var(--hpe-green)' : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isUser ? '#fff' : 'var(--text-main)', border: isUser ? 'none' : '1px solid var(--border-color)' }}>
                  {isUser ? <span style={{ fontSize: 12, fontWeight: 'bold' }}>{user?.username?.charAt(0).toUpperCase() || 'U'}</span> : <Bot size={16} />}
                </div>
                
                <div style={{ flex: 1, maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                  
                  {thinkText && (
                    <details 
                      open={msg.isStreaming}
                      style={{ 
                        marginBottom: 8, width: '100%', maxWidth: '800px', 
                        background: 'rgba(0, 0, 0, 0.2)', border: '1px solid var(--line)', 
                        borderRadius: 8, overflow: 'hidden' 
                      }}
                    >
                      <summary style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)', background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', outline: 'none', userSelect: 'none' }}>
                        <Sparkles size={12} style={{ color: 'var(--hpe-green)' }} />
                        <span style={{ fontWeight: 600 }}>AI Thinking Process (Click to toggle)</span>
                        {msg.isStreaming && <span className="pulsing-dot" style={{ width: 6, height: 6, background: 'var(--hpe-green)', borderRadius: '50%', display: 'inline-block', marginLeft: 4 }} />}
                      </summary>
                      <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', whiteSpace: 'pre-wrap', maxHeight: '250px', overflowY: 'auto', borderTop: '1px solid var(--line)' }}>
                        {thinkText}
                      </div>
                    </details>
                  )}

                  {displayHtml && (
                    <div className="markdown-body" style={{
                      background: isUser ? 'rgba(1, 169, 130, 0.1)' : 'var(--surface-2)',
                      padding: '16px 20px',
                      borderRadius: 12,
                      borderTopRightRadius: isUser ? 0 : 12,
                      borderTopLeftRadius: !isUser ? 0 : 12,
                      color: 'var(--text-main)',
                      fontSize: 14,
                      lineHeight: 1.6,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                      border: `1px solid ${isUser ? 'rgba(1, 169, 130, 0.2)' : 'var(--border-color)'}`
                    }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                        table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0', border: '1px solid var(--line)' }}>{children}</table>,
                        th: ({ children }) => <th style={{ background: 'var(--surface-3)', padding: '8px 10px', textAlign: 'left', border: '1px solid var(--line)', fontWeight: 600 }}>{children}</th>,
                        td: ({ children }) => <td style={{ padding: '6px 10px', border: '1px solid var(--line)' }}>{children}</td>,
                        code: ({ children, className }) => className ? <pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, overflowX: 'auto', fontSize: 12 }}><code>{children}</code></pre>
                          : <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{children}</code>
                      }}>{displayHtml}</ReactMarkdown>
                    </div>
                  )}

                  {/* Copy button */}
                  {displayHtml && !msg.isStreaming && (
                    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                      <CopyButton text={displayHtml} />
                    </div>
                  )}

                  {msg.agentSteps && msg.agentSteps.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <AgentStepTimeline steps={msg.agentSteps} />
                    </div>
                  )}
                  {msg.isAgent && showStepsInChat && msg.isStreaming && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingLeft: 4 }}>
                      <span className="pulse-dot blue" style={{ width: 8, height: 8 }} />
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        SAN Agent planning...
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--hpe-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white' }}>AI</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--hpe-green)', animation: `pulseDot 1.4s ease-in-out infinite`, animationDelay: `${i * 0.16}s` }} />)}
                </div>
                {aiMode === 'agent' && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    Reasoning... {(elapsedTime / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {aiMode === 'agent' && lastQuery && (
                <div style={{
                  marginLeft: 38,
                  fontSize: 12,
                  color: 'var(--accent-cyan)',
                  fontFamily: 'var(--font-mono)',
                  animation: 'fadeIn 0.5s infinite alternate',
                  background: 'rgba(57,197,207,0.05)',
                  border: '1px solid rgba(57,197,207,0.2)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  maxWidth: '70%'
                }}>
                  ⚙️ Active Plan: Resolving path mapping for &ldquo;{lastQuery}&rdquo;
                </div>
              )}
            </div>
          )}
          <div ref={msgEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--line)', background: 'linear-gradient(to top, var(--background), transparent)' }}>
          {pendingCommand && (
            <div style={{
              marginBottom: 12,
              padding: 16,
              background: 'var(--surface-2)',
              border: '1px solid var(--accent-cyan)',
              borderRadius: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="pulse-dot blue" style={{ width: 8, height: 8 }} />
                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-cyan)', letterSpacing: '0.5px' }}>
                  HUMAN-IN-THE-LOOP: COMMAND APPROVAL REQUIRED
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                The SAN Agent is running diagnostics on target array <strong>{pendingCommand.ip}</strong> and wants to execute the following command. Review and edit or approve/reject it below:
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid var(--line)' }}
                  value={pendingCommand.command || ''}
                  onChange={(e) => setPendingCommand({ ...pendingCommand, command: e.target.value })}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleTerminalApproval('approve', pendingCommand.command)}
                  style={{ background: 'var(--hpe-green)', borderColor: 'var(--hpe-green)', fontSize: 11 }}
                >
                  Approve & Execute
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => handleTerminalApproval('reject')}
                  style={{ background: 'var(--status-critical)', borderColor: 'var(--status-critical)', color: 'white', fontSize: 11 }}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 4 }}>
            <textarea ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
              placeholder="Ask about your SAN (Autonomous Agent mode)..."
              disabled={loading}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                padding: '12px 16px',
                color: 'var(--foreground)',
                fontSize: 15,
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                resize: 'none',
                lineHeight: '20px',
                height: 'auto',
                maxHeight: '160px',
                overflowY: 'auto'
              }}
            />
            {loading ? (
              <button onClick={stopGeneration} title="Stop generation"
                style={{ background: 'var(--status-critical)', border: 'none', color: 'white', width: 44, height: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                <span style={{ fontWeight: 900, fontSize: 16 }}>■</span>
              </button>
            ) : (
              <button onClick={() => sendMessage()} disabled={!input.trim()}
                style={{ background: 'var(--hpe-green)', border: 'none', color: 'white', width: 44, height: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s', opacity: !input.trim() ? 0.5 : 1 }}>
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {aiMode === 'agent' && agentResult && sidebarVisible && (
        <>
          <div
            onMouseDown={startResizing}
            style={{
              width: '4px',
              cursor: 'col-resize',
              background: 'transparent',
              transition: 'background 0.2s',
              zIndex: 10,
              alignSelf: 'stretch'
            }}
            onMouseOver={e => e.target.style.background = 'var(--hpe-green)'}
            onMouseOut={e => e.target.style.background = 'transparent'}
          />
          <AgentReasoningSidebar
            agentResult={agentResult}
            showSteps={showStepsInChat}
            onToggleSteps={() => setShowStepsInChat(s => !s)}
            width={sidebarWidth}
          />
        </>
      )}

      {/* ── Emulator Gateway Right Panel ─────────────────────────────────────── */}
      {showTerminalPanel && (
        <>
          {/* Drag-to-resize handle */}
          <div
            onMouseDown={startResizingEmu}
            style={{
              width: '4px',
              cursor: 'col-resize',
              background: 'transparent',
              alignSelf: 'stretch',
              zIndex: 10,
              transition: 'background 0.2s'
            }}
            onMouseOver={e => e.target.style.background = 'var(--hpe-green)'}
            onMouseOut={e => e.target.style.background = 'transparent'}
          />

          {/* Full Emulator Panel */}
          <div style={{
            width: emuPanelWidth,
            minWidth: 340,
            maxWidth: '65%',
            background: '#0d1117',
            borderLeft: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            alignSelf: 'stretch',
            color: '#c9d1d9',
            flexShrink: 0
          }}>
            <style dangerouslySetInnerHTML={{__html: `
              @keyframes deviceGlow {
                0% { box-shadow: 0 0 0 0 rgba(1,169,130,0); border-color: rgba(1,169,130,0.5); }
                30% { box-shadow: 0 0 18px 6px rgba(1,169,130,0.55); border-color: var(--hpe-green); }
                70% { box-shadow: 0 0 18px 6px rgba(1,169,130,0.55); border-color: var(--hpe-green); }
                100% { box-shadow: 0 0 0 0 rgba(1,169,130,0); border-color: rgba(1,169,130,0.5); }
              }
              @keyframes emuBlink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0; }
              }
              .emu-cursor {
                display: inline-block;
                width: 8px;
                height: 14px;
                background: #3fb950;
                margin-left: 2px;
                animation: emuBlink 1s step-start infinite;
                vertical-align: middle;
              }
            `}} />

            {/* Panel Header */}
            <div style={{
              padding: '10px 14px',
              background: '#161b22',
              borderBottom: '1px solid rgba(1,169,130,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hpe-green)', display: 'inline-block', boxShadow: '0 0 6px var(--hpe-green)', animation: 'pulse 2s ease infinite' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--hpe-green)', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>HPE SAN EMULATOR GATEWAY</span>
                <span style={{ fontSize: 9, color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 8 }}>Simulated SAN</span>
              </div>
              <button
                onClick={() => setShowTerminalPanel(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4, transition: 'color 0.15s' }}
                onMouseOver={e => e.currentTarget.style.color = '#f85149'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--muted)'}
              >
                <X size={13} />
              </button>
            </div>

            {/* Body: device sidebar + terminal */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

              {/* Device List Sidebar */}
              <div style={{ width: 170, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
                <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <Server size={12} style={{ color: 'var(--hpe-green)' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground)' }}>Available Host IPs</span>
                  <span style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 'auto', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 8 }}>{emuDevices.length}</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                  {emuDevices.length === 0 && (
                    <div style={{ padding: 12, textAlign: 'center', color: 'var(--muted)', fontSize: 10 }}>
                      No devices. Ensure simulation is running.
                    </div>
                  )}
                  {emuDevices.map(d => {
                    const name = d.name || d.ip
                    const isCurrent = emuActiveDevice?.ip === d.ip
                    const isHinted = arrayHint && (
                      (d.name || '').toLowerCase().includes(arrayHint.toLowerCase()) ||
                      (d.ip || '').includes(arrayHint)
                    )
                    const isGlowing = highlightedDevice === d.ip
                    return (
                      <button
                        key={name}
                        onClick={() => emuHandleSidebarClick(d)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 7,
                          border: isCurrent
                            ? '1px solid var(--hpe-green)'
                            : isHinted
                            ? '1px solid rgba(1,169,130,0.5)'
                            : '1px solid rgba(255,255,255,0.06)',
                          background: isCurrent
                            ? 'rgba(1,169,130,0.12)'
                            : isHinted
                            ? 'rgba(1,169,130,0.06)'
                            : 'rgba(255,255,255,0.02)',
                          color: isCurrent ? 'var(--hpe-green)' : isHinted ? 'rgba(1,169,130,0.9)' : 'var(--foreground)',
                          cursor: 'pointer',
                          fontSize: 11,
                          textAlign: 'left',
                          transition: 'all 0.2s ease',
                          marginBottom: 6,
                          animation: isGlowing ? 'deviceGlow 2.5s ease' : 'none',
                        }}
                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
                        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.borderColor = isCurrent ? 'var(--hpe-green)' : isHinted ? 'rgba(1,169,130,0.5)' : 'rgba(255,255,255,0.06)' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                          <Monitor size={11} style={{ color: isCurrent ? 'var(--hpe-green)' : 'var(--muted)', flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: 10 }}>{name}</span>
                          <span style={{ fontSize: 8, opacity: 0.7, textTransform: 'uppercase', flexShrink: 0 }}>{d.type}</span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: isCurrent ? 'var(--hpe-green)' : 'var(--muted)', marginTop: 3, opacity: 0.85 }}>
                          {emuGetSSHUser(d)}@{d.ip}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Terminal Area */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* Quick Command Pills */}
                {emuSshState === 'connected' && (
                  <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {emuGetDeviceCmds(emuActiveDevice).map(c => (
                      <button
                        key={c.label}
                        disabled={emuLoading}
                        onClick={() => emuRunQuickCommand(c.label)}
                        title={c.desc}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          padding: '3px 8px',
                          borderRadius: 5,
                          border: '1px solid rgba(1,169,130,0.35)',
                          background: 'rgba(1,169,130,0.06)',
                          color: '#e6edf3',
                          cursor: emuLoading ? 'not-allowed' : 'pointer',
                          opacity: emuLoading ? 0.5 : 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 160,
                          transition: 'all 0.15s'
                        }}
                        onMouseOver={e => { if (!emuLoading) e.currentTarget.style.background = 'rgba(1,169,130,0.15)' }}
                        onMouseOut={e => e.currentTarget.style.background = 'rgba(1,169,130,0.06)'}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Core Terminal Console */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0d1117', minHeight: 0 }}>
                  {/* Terminal header bar */}
                  <div style={{ padding: '6px 12px', background: '#161b22', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f85149', display: 'inline-block' }} />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e3b341', display: 'inline-block' }} />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3fb950', display: 'inline-block' }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6, flex: 1 }}>
                      {emuSshState === 'connected'
                        ? `Active SSH: ${emuActiveDevice?.name || emuActiveDevice?.ip}`
                        : 'Universal CLI Jump Console'}
                    </span>
                    <button
                      onClick={() => setEmuHistory([])}
                      style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--muted)', cursor: 'pointer', fontSize: 9, padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}
                    >
                      <RotateCcw size={9} />Clear
                    </button>
                  </div>

                  {/* Terminal body (output history) */}
                  <div
                    ref={emuTermBodyRef}
                    onClick={() => emuInputRef.current?.focus()}
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      padding: '12px 14px',
                      fontSize: 12,
                      lineHeight: 1.75,
                      cursor: 'text',
                      position: 'relative',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {emuHistory.map((line, i) => (
                      <div key={i} style={{ color: EMU_COL[line.type] || '#c8d6d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {line.text}
                      </div>
                    ))}

                    {/* Current typing line */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', color: '#e6edf3' }}>
                      <span style={{ color: emuSshState === 'connected' ? '#39c5cf' : '#e3b341', marginRight: 6, whiteSpace: 'pre' }}>
                        {emuPrompt}
                      </span>
                      <span style={{ color: '#e6edf3', whiteSpace: 'pre' }}>
                        {emuSshState === 'awaiting_password' ? '' : emuInput}
                      </span>
                      <span className="emu-cursor" />
                    </div>

                    {emuLoading && (
                      <div style={{ color: '#58a6ff', fontSize: 10, marginTop: 4 }}>executing…</div>
                    )}

                    {/* Hidden real input */}
                    <input
                      ref={emuInputRef}
                      type="text"
                      value={emuInput}
                      onChange={e => setEmuInput(e.target.value)}
                      onKeyDown={emuHandleKeyDown}
                      disabled={emuLoading}
                      style={{
                        position: 'absolute', left: '-9999px', top: '-9999px',
                        width: '1px', height: '1px', opacity: 0, overflow: 'hidden',
                        border: 'none', outline: 'none'
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}



      {/* Terminal Gateway Setup Modal Overlay */}
      {showConnectModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            width: 480,
            background: 'var(--surface-1)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: 'var(--foreground)'
          }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚙️</span> Terminal Gateway Connection Settings
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>Gateway Connection Protocol</label>
              <select
                className="input"
                value="simulated"
                disabled
                style={{ background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--line)', outline: 'none', opacity: 1 }}
              >
                <option value="simulated">✅ Emulator Gateway (Simulated SAN — Active)</option>
              </select>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                {[
                  { label: '🔒 Local Host Terminal (Windows PowerShell Core)', reason: 'Not supported — agent cannot handle failed commands' },
                  { label: '🔒 Remote Host Session (Secure Shell SSH Tunnel)', reason: 'Not supported — manual SSH setup required' },
                  { label: '🔒 Interactive Desktop Terminal (Select Open Window)', reason: 'Not supported — platform-specific & fragile' },
                ].map((opt, i) => (
                  <div key={i} style={{
                    padding: '7px 10px', borderRadius: 6,
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    opacity: 0.45,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>{opt.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', background: 'rgba(248,81,73,0.12)', border: '1px solid rgba(248,81,73,0.2)', padding: '1px 6px', borderRadius: 10, flexShrink: 0 }}>Disabled</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>Agent Execution Mode</label>
              <select 
                className="input" 
                value={terminalMode} 
                onChange={(e) => setTerminalMode(e.target.value)}
                style={{ background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--line)', outline: 'none' }}
              >
                <option value="auto">Auto-Execute Mode (Full Unattended Diagnostics)</option>
                <option value="manual">Manual Approval Mode (Human-in-the-loop validation)</option>
              </select>
            </div>

            {terminalType === 'ssh' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>SSH Target IP / Hostname</label>
                  <input className="input" placeholder="e.g. 10.20.10.5" value={sshHost} onChange={(e) => setSshHost(e.target.value)} style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--foreground)' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Username</label>
                    <input className="input" placeholder="admin" value={sshUser} onChange={(e) => setSshUser(e.target.value)} style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--foreground)' }} />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Password</label>
                    <input className="input" type="password" placeholder="••••••••" value={sshPass} onChange={(e) => setSshPass(e.target.value)} style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--foreground)' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Emulator Gateway info card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(1,169,130,0.04)', padding: 14, borderRadius: 8, border: '1px solid rgba(1,169,130,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🖥️</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>Emulator Gateway (Simulated SAN)</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Full HPE SAN simulated environment · No real hardware needed</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Full HPE SAN simulated environment active</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: 'rgba(1,169,130,0.15)', color: 'var(--hpe-green)', border: '1px solid rgba(1,169,130,0.3)' }}>Active</span>
              </div>
            </div>


            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn" onClick={() => setShowConnectModal(false)} style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--foreground)' }}>
                Close
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => handleTerminalConnect('simulated', terminalMode, '', '', '', '')}
                style={{ background: 'var(--hpe-green)', borderColor: 'var(--hpe-green)', color: 'white' }}
              >
                Apply & Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
