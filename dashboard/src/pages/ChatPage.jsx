import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { AuthContext } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Sparkles, Database, MessageSquare, Plus, RotateCcw, Bot, Trash2 } from 'lucide-react'
import AgentStepTimeline from '../components/AgentStepTimeline'
import AgentReasoningSidebar from '../components/AgentReasoningSidebar'

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
  const [chatHistory, setChatHistory] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [agentResult, setAgentResult] = useState(null)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [showStepsInChat, setShowStepsInChat] = useState(true)
  const [arrayHint, setArrayHint] = useState(() => sessionStorage.getItem('agent_array_hint') || '')
  const msgEndRef = useRef(null)
  const inputRef = useRef(null)

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
  }, [])

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    setInput('')
    setLastQuery(trimmed)
    setMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setLoading(true)
    if (aiMode === 'agent') setAgentResult(null)

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
        const es = new EventSource(`${apiBase}/api/agent/run/stream?query=${qParam}&array=${aParam}`)

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

      if (aiMode === 'graphrag') {
        // GraphRAG mode — uses Flask backend's Groq+Neo4j RAG engine
        const res = await fetch(`${apiBase}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed })
        })
        const data = await res.json()
        answer = data.answer || data.response || 'No response from GraphRAG engine.'
        
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
        answer = data.response || data.message || data.answer || (data.messages ? data.messages[data.messages.length - 1].content : 'No response from AI.')
        
        if (data.chatId && !activeChatId) {
          setActiveChatId(data.chatId)
          fetchHistory() // Refresh sidebar to show the new chat entry
        }
      }
      setMessages(prev => [...prev, { role: 'assistant', text: answer }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}. Make sure the backend is running.` }])
    } finally { setLoading(false) }
  }, [input, loading, aiMode, apiBase, chatbotApi, user, messages, activeChatId, arrayHint])

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

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>HPE SAN AI Assistant</span>
            <span className={`badge ${aiMode === 'agent' ? 'badge-ok' : aiMode === 'graphrag' ? 'badge-info' : 'badge-ok'}`}>
              {aiMode === 'agent' ? 'SAN Agent' : aiMode === 'standard' ? 'Standard RAG' : 'GraphRAG'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            <div style={{ maxWidth: 600, margin: '40px auto', textAlign: 'center' }}>
              <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8, color: 'var(--foreground)' }}>
                Hello, {user?.username || 'there'}! 👋
              </h2>
              <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 14, lineHeight: 1.6 }}>
                Ask me anything about your HPE SAN infrastructure. I can analyze topology, diagnose issues, and provide recommendations.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {QUICK_QUERIES.map((q, i) => (
                  <button key={i} onClick={() => sendMessage(q.text)}
                    style={{
                      background: 'var(--surface-1)', border: '1px solid var(--line)', borderRadius: 10,
                      padding: '12px 16px', cursor: 'pointer', color: 'var(--foreground)', fontSize: 13,
                      textAlign: 'left', transition: 'all 0.15s', fontFamily: 'var(--font-sans)',
                    }}
                    onMouseOver={e => e.target.style.borderColor = 'var(--hpe-green)'}
                    onMouseOut={e => e.target.style.borderColor = 'var(--line)'}
                  >{q.label}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 20, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'assistant' && (
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--hpe-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', marginRight: 10, flexShrink: 0 }}>AI</div>
              )}
              <div style={{
                maxWidth: '70%', padding: '12px 16px', borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                background: msg.role === 'user' ? 'rgba(255,255,255,0.05)' : 'rgba(1,169,130,0.06)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(255,255,255,0.08)' : 'rgba(1,169,130,0.15)'}`,
              }}>
                {msg.role === 'assistant' ? (
                  <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0', border: '1px solid var(--line)' }}>{children}</table>,
                    th: ({ children }) => <th style={{ background: 'var(--surface-3)', padding: '8px 10px', textAlign: 'left', border: '1px solid var(--line)', fontWeight: 600 }}>{children}</th>,
                    td: ({ children }) => <td style={{ padding: '6px 10px', border: '1px solid var(--line)' }}>{children}</td>,
                    code: ({ children, className }) => className ? <pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, overflowX: 'auto', fontSize: 12 }}><code>{children}</code></pre>
                      : <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{children}</code>
                  }}>{msg.text}</ReactMarkdown>
                  {msg.isAgent && showStepsInChat && (msg.agentSteps?.length > 0 || msg.isStreaming) && (
                    <div style={{ marginTop: 16 }}>
                      {msg.agentSteps?.length > 0 && <AgentStepTimeline steps={msg.agentSteps} />}
                      {msg.isStreaming && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingLeft: 4 }}>
                          <span className="pulse-dot blue" style={{ width: 8, height: 8 }} />
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                            SAN Agent executing next trace step...
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  </>
                ) : msg.text}
              </div>
            </div>
          ))}
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
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ background: 'var(--hpe-green)', border: 'none', color: 'white', width: 44, height: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s', opacity: loading || !input.trim() ? 0.5 : 1 }}>
              <Send size={18} />
            </button>
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
    </div>
  )
}
