import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { AuthContext } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Sparkles, Database, MessageSquare, Plus, RotateCcw, Bot, Trash2, Copy, Check, Upload, FileText, CheckCircle2, AlertTriangle, X, Cpu } from 'lucide-react'
import AgentStepTimeline from '../components/AgentStepTimeline'
import RadialMenu from '../components/RadialMenu'
import AgentReasoningSidebar from '../components/AgentReasoningSidebar'
import EmbeddedTerminal from '../components/EmbeddedTerminal'

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

export default function ChatPage({ apiBase, chatbotApi }) {
  const { user } = useContext(AuthContext)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastQuery, setLastQuery] = useState('')
  const [elapsedTime, setElapsedTime] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [aiMode, setAiMode] = useState('agent') // agent | standard | graphrag
  const [useOllama, setUseOllama] = useState(false)
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
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [showStepsInChat, setShowStepsInChat] = useState(true)
  const [arrayHint, setArrayHint] = useState(() => sessionStorage.getItem('agent_array_hint') || '')
  const [radialPos, setRadialPos] = useState(null)
  const [showTerminalPanel, setShowTerminalPanel] = useState(false)
  const terminalRef = useRef(null)
  const msgEndRef = useRef(null)
  const inputRef = useRef(null)
  const llmFileRef = useRef(null)

  // ── LLM Ingest State ─────────────────────────────────────────────────────
  const [showLLMIngest, setShowLLMIngest] = useState(false)
  const [llmIngestPhase, setLLMIngestPhase] = useState('idle') // idle | running | done | error
  const [llmIngestLogs, setLLMIngestLogs] = useState([])
  const [llmIngestResult, setLLMIngestResult] = useState(null)
  const [llmIngestError, setLLMIngestError] = useState(null)
  const [llmIngestFile, setLLMIngestFile] = useState(null)
  const [llmIngestStep, setLLMIngestStep] = useState(0) // 0-4 pipeline step index
  const llmLogsEndRef = useRef(null)

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

  const scrollBottom = () => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        setMessages(data.messages.map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, text: m.content })))
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

  useEffect(() => {
    if (terminalType === 'desktop' && showConnectModal) {
      fetchActiveWindows()
    }
  }, [terminalType, showConnectModal, fetchActiveWindows])

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
    try {
      const res = await fetch(`${apiBase}/api/terminal/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, executionMode: mode, host, username, password, hwnd })
      })
      if (res.ok) {
        setTerminalType(type)
        setTerminalMode(mode)
        if (hwnd) setSelectedHwnd(hwnd)
        setShowConnectModal(false)
        if (type === 'desktop') {
          setShowTerminalPanel(true)
        }
      }
    } catch(e) {}
  }

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    setInput('')
    setLastQuery(trimmed)
    setMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setLoading(true)
    if (aiMode === 'agent') setAgentResult(null)

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
        const es = new EventSource(`${apiBase}/api/agent/run/stream?query=${qParam}&array=${aParam}&useOllama=${ollamaParam}&disableThink=${thinkParam}&requestId=${reqId}`)
        activeEsRef.current = es

        es.onmessage = (e) => {
          const event = JSON.parse(e.data)
          if (event.type === 'step') {
            const step = event.step
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
                    text: `### Running Diagnostics...\nCurrently executing: **${step.title}**\n\n*${step.detail || ''}*`
                  }
                ]
              }
              return prev
            })
          } else if (event.type === 'final') {
            const data = event.result
            setAgentResult(data)
            setMessages(prev => {
              if (prev.length === 0) return prev
              const last = prev[prev.length - 1]
              if (last && last.role === 'assistant') {
                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    agentSteps: data.steps,
                    text: data.answer || 'Agent completed successfully.',
                    isStreaming: false
                  }
                ]
              }
              return prev
            })
            setLoading(false)
            es.close()

            // SAVE AGENT CHAT TO MONGODB HISTORY!
            try {
              fetch(`${chatbotApi}/chat/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
                body: JSON.stringify({
                  message: trimmed,
                  chatId: activeChatId || undefined,
                  customResponse: data.answer || 'Agent completed successfully.'
                })
              }).then(res => res.json()).then(saveData => {
                if (saveData.chatId && !activeChatId) {
                  setActiveChatId(saveData.chatId)
                  fetchHistory() // Refresh sidebar to show the new chat entry
                }
              }).catch(err => console.error("Failed to save Agent chat to history:", err))
            } catch (saveErr) {
              console.error("Failed to save Agent chat to history:", saveErr)
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

      if (useOllama && (aiMode === 'graphrag' || aiMode === 'standard')) {
        // SSE Streaming for Ollama
        setMessages(prev => [...prev, { role: 'assistant', text: '', isStreaming: true, isOllama: true }])
        
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
    } finally { setLoading(false) }
  }, [input, loading, aiMode, apiBase, chatbotApi, user, messages, activeChatId, arrayHint])

  // ── LLM Log Ingest Handler ────────────────────────────────────────────────
  const startLLMIngest = useCallback(async (file) => {
    if (!file) return
    setLLMIngestFile(file)
    setShowLLMIngest(true)
    setLLMIngestPhase('running')
    setLLMIngestLogs([])
    setLLMIngestResult(null)
    setLLMIngestError(null)
    setLLMIngestStep(0)

    const addLog = (msg, type = 'info') => {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
      setLLMIngestLogs(prev => [...prev, { msg, type, ts }])
    }

    const STEP_MSGS = [
      'Creating backup of current environment...',
      'Sending log to SAN Agent LLM parser...',
      'Populating databases with extracted arrays...',
      'Generating persistent snapshot...',
    ]

    addLog(`Starting LLM ingest for: ${file.name}`, 'system')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const snapshotLabel = encodeURIComponent(`✨ LLM Ingest: ${file.name}`)
      const res = await fetch(
        `${apiBase}/api/ingest/log/ai?label=${snapshotLabel}`,
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
        buffer = parts.pop() // keep incomplete chunk
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'progress') {
              addLog(event.msg, 'progress')
              // Advance step based on message content
              const msg = (event.msg || '').toLowerCase()
              if (msg.includes('backup')) setLLMIngestStep(0)
              else if (msg.includes('llm') || msg.includes('chunk') || msg.includes('wip')) setLLMIngestStep(1)
              else if (msg.includes('popul') || msg.includes('databas')) setLLMIngestStep(2)
              else if (msg.includes('snapshot')) setLLMIngestStep(3)
            } else if (event.type === 'warning') {
              addLog(event.msg, 'warn')
            } else if (event.type === 'final') {
              setLLMIngestStep(4)
              setLLMIngestResult(event)
              setLLMIngestPhase('done')
              addLog(`Done! Parsed ${event.arrays_parsed ?? 0} array(s).`, 'success')
              if (event.snapshot_id) {
                addLog(`Snapshot saved: ${event.snapshot_id}`, 'success')
              }
            }
          } catch (parseErr) {
            // ignore malformed SSE line
          }
        }
      }
    } catch (err) {
      addLog(`Error: ${err.message}`, 'error')
      setLLMIngestError(err.message)
      setLLMIngestPhase('error')
    }
  }, [apiBase])

  const handleLLMFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) startLLMIngest(file)
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  // Auto-scroll terminal logs
  useEffect(() => {
    llmLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [llmIngestLogs])

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

  const LLM_STEPS = [
    { label: 'Backup', icon: '🛡️', desc: 'Saving current state' },
    { label: 'LLM Parse', icon: '🤖', desc: 'AI extracting arrays' },
    { label: 'Populate', icon: '🗄️', desc: 'Loading databases' },
    { label: 'Snapshot', icon: '📸', desc: 'Creating source' },
  ]

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

      {/* ── LLM Ingest Overlay ────────────────────────────────────────────── */}
      {showLLMIngest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.88)',
          backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.25s ease',
        }}>
          <div style={{
            width: '100%', maxWidth: 680,
            margin: '0 20px',
            background: 'linear-gradient(145deg, rgba(22,27,34,0.98) 0%, rgba(13,17,23,0.98) 100%)',
            border: '1px solid rgba(72,79,88,0.5)',
            borderRadius: 20,
            boxShadow: '0 40px 120px rgba(0,0,0,0.7), 0 0 60px rgba(1,169,130,0.08)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 24px 16px',
              borderBottom: '1px solid rgba(72,79,88,0.3)',
              background: 'linear-gradient(90deg, rgba(1,169,130,0.08) 0%, transparent 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(1,169,130,0.3) 0%, rgba(88,166,255,0.2) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(1,169,130,0.3)',
                }}>
                  <Cpu size={20} style={{ color: 'var(--hpe-green)' }} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>Parse Log with LLM</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {llmIngestFile?.name || 'Processing file...'}
                  </div>
                </div>
              </div>
              {(llmIngestPhase === 'done' || llmIngestPhase === 'error' || llmIngestPhase === 'idle') && (
                <button
                  onClick={() => { setShowLLMIngest(false); setLLMIngestPhase('idle') }}
                  style={{
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(72,79,88,0.4)',
                    borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                    color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12
                  }}
                >
                  <X size={13} /> Close
                </button>
              )}
            </div>

            {/* Step Pipeline */}
            <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid rgba(72,79,88,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {LLM_STEPS.map((step, i) => {
                  const done = llmIngestStep > i || llmIngestPhase === 'done'
                  const active = llmIngestStep === i && llmIngestPhase === 'running'
                  const isLast = i === LLM_STEPS.length - 1
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 0 : 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 15,
                          background: done
                            ? 'rgba(1,169,130,0.2)'
                            : active
                              ? 'rgba(88,166,255,0.15)'
                              : 'rgba(72,79,88,0.2)',
                          border: `2px solid ${
                            done ? 'rgba(1,169,130,0.6)'
                              : active ? 'rgba(88,166,255,0.6)'
                                : 'rgba(72,79,88,0.3)'
                          }`,
                          boxShadow: active ? '0 0 12px rgba(88,166,255,0.3)' : 'none',
                          animation: active ? 'pulse 1.5s ease infinite' : 'none',
                          transition: 'all 0.4s ease',
                        }}>
                          {done ? <CheckCircle2 size={16} style={{ color: 'var(--hpe-green)' }} /> : step.icon}
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: done ? 'var(--hpe-green)' : active ? 'var(--accent-blue)' : 'var(--muted)' }}>
                            {step.label}
                          </div>
                        </div>
                      </div>
                      {!isLast && (
                        <div style={{
                          flex: 1, height: 2, margin: '0 6px', marginTop: -18,
                          background: done ? 'var(--hpe-green)' : 'rgba(72,79,88,0.3)',
                          transition: 'background 0.4s ease',
                          borderRadius: 1,
                        }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Retro Terminal Log */}
            <div style={{
              margin: '0 24px 0',
              height: 180,
              background: '#0a0c10',
              border: '1px solid rgba(72,79,88,0.3)',
              borderRadius: 10,
              overflow: 'hidden',
              marginTop: 16,
            }}>
              <div style={{
                padding: '6px 12px',
                background: 'rgba(255,255,255,0.03)',
                borderBottom: '1px solid rgba(72,79,88,0.2)',
                display: 'flex', alignItems: 'center', gap: 6
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f85149' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#d29922' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3fb950' }} />
                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6, fontFamily: 'var(--font-mono)' }}>san-llm-agent — ingest stream</span>
                {llmIngestPhase === 'running' && (
                  <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--hpe-green)', animation: 'pulse 1s ease infinite' }} />
                )}
              </div>
              <div style={{
                padding: '10px 14px',
                height: 'calc(100% - 33px)',
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                lineHeight: 1.7,
              }}>
                {llmIngestLogs.length === 0 && (
                  <span style={{ color: 'rgba(139,148,158,0.5)' }}>Waiting for stream...</span>
                )}
                {llmIngestLogs.map((log, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 2 }}>
                    <span style={{ color: 'rgba(139,148,158,0.5)', flexShrink: 0 }}>{log.ts}</span>
                    <span style={{
                      color: log.type === 'error' ? '#f85149'
                        : log.type === 'warn' ? '#d29922'
                          : log.type === 'success' ? '#3fb950'
                            : log.type === 'system' ? '#bc8cff'
                              : '#58a6ff'
                    }}>
                      {log.type === 'progress' ? '▶ ' : log.type === 'success' ? '✓ ' : log.type === 'warn' ? '⚠ ' : log.type === 'error' ? '✗ ' : '» '}
                      {log.msg}
                    </span>
                  </div>
                ))}
                <div ref={llmLogsEndRef} />
              </div>
            </div>

            {/* Success card */}
            {llmIngestPhase === 'done' && llmIngestResult && (
              <div style={{ margin: '16px 24px 0', padding: '16px 20px', background: 'rgba(1,169,130,0.08)', border: '1px solid rgba(1,169,130,0.25)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <CheckCircle2 size={16} style={{ color: 'var(--hpe-green)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--hpe-green)' }}>Ingest Complete</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                    {llmIngestResult.arrays_parsed ?? 0} array{(llmIngestResult.arrays_parsed ?? 0) !== 1 ? 's' : ''} loaded
                  </span>
                </div>
                {llmIngestResult.arrays && llmIngestResult.arrays.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {llmIngestResult.arrays.map((arr, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(72,79,88,0.3)',
                        borderRadius: 8,
                      }}>
                        <Database size={13} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>{arr.name || 'Unnamed Array'}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                            {arr.model || ''}{arr.serial ? ` · S/N: ${arr.serial}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {llmIngestResult.snapshot_id && (
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--accent-purple)' }}>📸</span>
                    Snapshot saved: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)' }}>{llmIngestResult.snapshot_id}</code>
                  </div>
                )}
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    marginTop: 14, width: '100%', padding: '9px 0',
                    background: 'var(--hpe-green)', border: 'none', borderRadius: 8,
                    color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  🔄 Reload Dashboard to Apply
                </button>
              </div>
            )}

            {/* Error state */}
            {llmIngestPhase === 'error' && (
              <div style={{ margin: '16px 24px 0', padding: '14px 16px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={14} style={{ color: '#f85149' }} />
                  <span style={{ fontSize: 12, color: '#f85149', fontWeight: 600 }}>Ingest Failed</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>{llmIngestError}</div>
              </div>
            )}

            <div style={{ height: 20 }} />
          </div>
        </div>
      )}

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

      {/* Chat sidebar */}
      <div style={{ width: 260, flexShrink: 0, background: 'var(--surface-1)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={newChat}>
            <Plus size={16} /> New Chat
          </button>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input className="input" placeholder="Search chats..." value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} style={{ fontSize: 12 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          <div className="section-label" style={{ padding: '8px 8px 4px' }}>Recent History</div>
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
        {/* AI Mode toggle */}
        <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
          <div className="section-label" style={{ marginBottom: 8 }}>AI Engine</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button className={`btn btn-sm ${aiMode === 'agent' ? 'btn-primary' : ''}`} style={{ justifyContent: 'center', fontSize: 10 }}
              onClick={() => setAiMode('agent')}>
              <Bot size={12} /> SAN Agent
            </button>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className={`btn btn-sm ${aiMode === 'standard' ? 'btn-primary' : ''}`} style={{ flex: 1, justifyContent: 'center', fontSize: 10 }}
                onClick={() => setAiMode('standard')}>
                <Sparkles size={12} /> Standard
              </button>
              <button className={`btn btn-sm ${aiMode === 'graphrag' ? 'btn-primary' : ''}`} style={{ flex: 1, justifyContent: 'center', fontSize: 10 }}
                onClick={() => setAiMode('graphrag')}>
                <Database size={12} /> GraphRAG
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-main)' }}>Disable Thinking</span>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{
                  width: 28, height: 14, borderRadius: 7, background: disableThink ? 'var(--status-critical)' : 'var(--line)',
                  position: 'relative', transition: 'background 0.2s'
                }}>
                  <div style={{
                    position: 'absolute', top: 2, left: disableThink ? 16 : 2, width: 10, height: 10, borderRadius: 5,
                    background: 'white', transition: 'left 0.2s'
                  }} />
                </div>
                <input type="checkbox" checked={disableThink} onChange={() => setDisableThink(!disableThink)} style={{ display: 'none' }} />
              </label>
            </div>
          )}

          {aiMode === 'agent' && (
            <input
              className="input"
              style={{ marginTop: 8, fontSize: 11 }}
              placeholder="Array hint (e.g. PROD-A)"
              value={arrayHint}
              onChange={e => {
                setArrayHint(e.target.value)
                sessionStorage.setItem('agent_array_hint', e.target.value)
              }}
            />
          )}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
            {aiMode === 'agent' && 'Simulator CLI → existing parsers → Neo4j → answer'}
            {aiMode === 'standard' && 'Gemini AI with SAN context enrichment'}
            {aiMode === 'graphrag' && 'Groq LLM with Neo4j graph traversal queries'}
          </div>
        </div>
      </div>

      {/* Chat main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Sparkles size={18} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>HPE SAN AI Assistant</span>
            <span className={`badge ${aiMode === 'agent' ? 'badge-ok' : aiMode === 'graphrag' ? 'badge-info' : 'badge-ok'}`}>
              {aiMode === 'agent' ? 'SAN Agent' : aiMode === 'standard' ? 'Standard RAG' : 'GraphRAG'}
            </span>
            
            {/* Terminal Gateway connection state */}
            <span 
              onClick={() => setShowConnectModal(true)}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--line)',
                color: terminalType === 'simulated' ? 'var(--text-secondary)' : 'var(--hpe-green)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title="Click to configure terminal gateway connection settings"
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: terminalType === 'simulated' ? 'var(--muted)' : 'var(--hpe-green)', display: 'inline-block' }} />
              {terminalType === 'simulated' && 'Simulated Env'}
              {terminalType === 'local' && 'Local PS Core'}
              {terminalType === 'ssh' && `SSH: ${sshHost || 'Host'}`}
              {terminalType === 'desktop' && 'Embedded Shell'}
              {terminalMode === 'manual' && ' (Human-in-Loop)'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* ✨ Parse Log with LLM button */}
            <button
              id="llm-ingest-btn"
              className="btn btn-sm"
              onClick={() => llmFileRef.current?.click()}
              style={{
                background: 'linear-gradient(135deg, rgba(1,169,130,0.15) 0%, rgba(88,166,255,0.1) 100%)',
                border: '1px solid rgba(1,169,130,0.35)',
                color: 'var(--hpe-green)',
                fontSize: 11,
                fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(1,169,130,0.25) 0%, rgba(88,166,255,0.18) 100%)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(1,169,130,0.2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(1,169,130,0.15) 0%, rgba(88,166,255,0.1) 100%)'; e.currentTarget.style.boxShadow = 'none' }}
              title="Parse a raw log file using the SAN LLM agent"
            >
              <Sparkles size={11} />
              Parse Log with LLM
            </button>
            <button 
              className="btn btn-sm"
              onClick={() => setShowConnectModal(true)}
              style={{
                background: 'var(--surface-3)',
                borderColor: 'var(--line)',
                fontSize: 11
              }}
            >
              ⚙️ Gateway Setup
            </button>
            {aiMode === 'agent' && agentResult && (
              <button
                className="btn btn-sm"
                onClick={() => setSidebarVisible(v => !v)}
                style={{
                  background: 'var(--surface-3)',
                  borderColor: sidebarVisible ? 'var(--hpe-green)' : 'var(--line)',
                  color: sidebarVisible ? 'var(--hpe-green)' : 'var(--foreground)',
                }}
              >
                📊 {sidebarVisible ? 'Hide Analysis' : 'Show Analysis'}
              </button>
            )}
            <button className="btn btn-sm" onClick={newChat}><RotateCcw size={12} /> Reset</button>
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
                    <div style={{ 
                      marginBottom: 8, width: '100%', maxWidth: '800px', 
                      background: 'rgba(0, 0, 0, 0.2)', border: '1px solid var(--line)', 
                      borderRadius: 8, overflow: 'hidden' 
                    }}>
                      <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--muted)', background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={12} />
                        <span>AI Thinking Process</span>
                        {msg.isStreaming && <span className="pulsing-dot" style={{ width: 6, height: 6, background: 'var(--hpe-green)', borderRadius: '50%', display: 'inline-block', marginLeft: 4 }} />}
                      </div>
                      <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', whiteSpace: 'pre-wrap', maxHeight: msg.isStreaming ? 'none' : '200px', overflowY: 'auto' }}>
                        {thinkText}
                      </div>
                    </div>
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
                        SAN Agent executing next trace step...
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

        {/* Embedded Terminal Panel - shown when desktop mode is active */}
        {terminalType === 'desktop' && (
          <div style={{
            borderTop: '1px solid var(--line)',
            background: '#0d1117',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            height: showTerminalPanel ? 260 : 36,
            transition: 'height 0.25s ease',
            overflow: 'hidden',
          }}>
            {/* Terminal header bar */}
            <div
              onClick={() => setShowTerminalPanel(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
                cursor: 'pointer', userSelect: 'none', flexShrink: 0,
                borderBottom: showTerminalPanel ? '1px solid rgba(255,255,255,0.06)' : 'none',
                background: 'rgba(0,0,0,0.3)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hpe-green)', display: 'inline-block', boxShadow: '0 0 6px var(--hpe-green)' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--hpe-green)', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>EMBEDDED SHELL</span>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{showTerminalPanel ? '▾ collapse' : '▸ expand'}</span>
            </div>
            {/* xterm.js terminal */}
            {showTerminalPanel && (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <EmbeddedTerminal ref={terminalRef} apiBase={apiBase} active={terminalType === 'desktop'} />
              </div>
            )}
          </div>
        )}

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
              placeholder={`Ask about your SAN (${aiMode === 'agent' ? 'SAN Agent' : aiMode === 'graphrag' ? 'GraphRAG' : 'Standard'} mode)...`}
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
                value={terminalType} 
                onChange={(e) => setTerminalType(e.target.value)}
                style={{ background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--line)', outline: 'none' }}
              >
                <option value="simulated">Simulated Environment (Default Offline Simulator)</option>
                <option value="local">Local Host Terminal (Windows PowerShell Core)</option>
                <option value="ssh">Remote Host Session (Secure Shell SSH Tunnel)</option>
                <option value="desktop">Interactive Desktop Terminal (Select Open Window)</option>
              </select>
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

            {terminalType === 'desktop' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.15)', padding: 14, borderRadius: 8, border: '1px solid rgba(1,169,130,0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🖥️</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>Embedded Browser Terminal</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Powered by xterm.js · Works on Windows, Linux &amp; macOS</div>
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: 'rgba(1,169,130,0.15)', color: 'var(--hpe-green)', border: '1px solid rgba(1,169,130,0.3)' }}>No setup required</span>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7, padding: '8px 0' }}>
                  Clicking <b style={{ color: 'var(--foreground)' }}>Apply &amp; Connect</b> will:
                  <ol style={{ margin: '6px 0 0 16px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <li>Spawn a live <b>PowerShell</b> (Windows) or <b>bash</b> (Linux/macOS) process on the server</li>
                    <li>Open an <b>embedded terminal panel</b> at the bottom of the chat page</li>
                    <li>Stream all command output <b>live into the browser terminal</b></li>
                    <li>Let the SAN Agent run diagnostics — you'll see each command execute in real time</li>
                  </ol>
                </div>

                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(1,169,130,0.06)', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(1,169,130,0.15)' }}>
                  <span style={{ color: 'var(--hpe-green)', fontSize: 14 }}>✓</span>
                  <span>The mock CLI commands (<code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>showsys</code>, <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>showhost</code>, etc.) are automatically added to the shell PATH.</span>
                </div>
              </div>
            )}


            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn" onClick={() => setShowConnectModal(false)} style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--foreground)' }}>
                Close
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => handleTerminalConnect(terminalType, terminalMode, sshHost, sshUser, sshPass, selectedHwnd)}
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
