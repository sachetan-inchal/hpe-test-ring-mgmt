import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { AuthContext } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Sparkles, Database, MessageSquare, Plus, Trash2, Zap, Search, RotateCcw } from 'lucide-react'

const QUICK_QUERIES = [
  '🔍 Show all storage arrays and their status',
  '⚠️ List all degraded or failed components',
  '💾 Storage capacity utilization summary',
  '🔌 Show switch health and port status',
  '🖥️ List connected hosts and their multipath status',
  '📊 Give me a full SAN infrastructure report',
]

export default function ChatPage({ apiBase, chatbotApi }) {
  const { user } = useContext(AuthContext)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiMode, setAiMode] = useState('standard') // 'standard' or 'graphrag'
  const [chatHistory, setChatHistory] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const msgEndRef = useRef(null)
  const inputRef = useRef(null)

  const scrollBottom = () => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  useEffect(scrollBottom, [messages])

  // Load chat history from chatbot service
  useEffect(() => {
    if (!user?.token) return
    fetch(`${chatbotApi}/chat`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(r => r.ok ? r.json() : []).then(d => setChatHistory(Array.isArray(d) ? d : d.chats || []))
      .catch(() => {})
  }, [chatbotApi, user])

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

  const newChat = () => { setMessages([]); setActiveChatId(null) }

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setLoading(true)

    try {
      let answer = ''
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
      } else {
        // Standard mode — uses chatbot service's Gemini AI with SAN context
        const res = await fetch(`${chatbotApi}/chat/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
          body: JSON.stringify({
            message: trimmed,
            chatId: activeChatId || undefined,
            history: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.text }))
          })
        })
        const data = await res.json()
        answer = data.response || data.message || data.answer || 'No response from AI.'
        if (data.chatId && !activeChatId) setActiveChatId(data.chatId)
      }
      setMessages(prev => [...prev, { role: 'assistant', text: answer }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}. Make sure the backend is running.` }])
    } finally { setLoading(false) }
  }, [input, loading, aiMode, apiBase, chatbotApi, user, messages, activeChatId])

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }

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
            <button key={chat._id} onClick={() => loadChat(chat._id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
              borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
              background: activeChatId === chat._id ? 'var(--hpe-green-light)' : 'transparent',
              color: activeChatId === chat._id ? 'var(--hpe-green)' : 'var(--muted)',
              textAlign: 'left', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
            }}>
              <MessageSquare size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title || 'New Chat'}</span>
            </button>
          ))}
        </div>
        {/* AI Mode toggle */}
        <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
          <div className="section-label" style={{ marginBottom: 8 }}>AI Engine</div>
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
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
            {aiMode === 'standard' ? 'Gemini AI with SAN context enrichment' : 'Groq LLM with Neo4j graph traversal queries'}
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
            <span className={`badge ${aiMode === 'graphrag' ? 'badge-info' : 'badge-ok'}`}>
              {aiMode === 'standard' ? 'Standard RAG' : 'GraphRAG'}
            </span>
          </div>
          <button className="btn btn-sm" onClick={newChat}><RotateCcw size={12} /> Reset</button>
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
                  <button key={i} onClick={() => sendMessage(q.replace(/^[^\s]+\s/, ''))}
                    style={{
                      background: 'var(--surface-1)', border: '1px solid var(--line)', borderRadius: 10,
                      padding: '12px 16px', cursor: 'pointer', color: 'var(--foreground)', fontSize: 13,
                      textAlign: 'left', transition: 'all 0.15s', fontFamily: 'var(--font-sans)',
                    }}
                    onMouseOver={e => e.target.style.borderColor = 'var(--hpe-green)'}
                    onMouseOut={e => e.target.style.borderColor = 'var(--line)'}
                  >{q}</button>
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0', border: '1px solid var(--line)' }}>{children}</table>,
                    th: ({ children }) => <th style={{ background: 'var(--surface-3)', padding: '8px 10px', textAlign: 'left', border: '1px solid var(--line)', fontWeight: 600 }}>{children}</th>,
                    td: ({ children }) => <td style={{ padding: '6px 10px', border: '1px solid var(--line)' }}>{children}</td>,
                    code: ({ children, className }) => className ? <pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, overflowX: 'auto', fontSize: 12 }}><code>{children}</code></pre>
                      : <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{children}</code>
                  }}>{msg.text}</ReactMarkdown>
                ) : msg.text}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 13 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--hpe-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white' }}>AI</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--hpe-green)', animation: `pulseDot 1.4s ease-in-out infinite`, animationDelay: `${i * 0.16}s` }} />)}
              </div>
            </div>
          )}
          <div ref={msgEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--line)', background: 'linear-gradient(to top, var(--background), transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 4 }}>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={`Ask about your SAN (${aiMode === 'graphrag' ? 'GraphRAG' : 'Standard'} mode)...`}
              disabled={loading}
              style={{ flex: 1, background: 'transparent', border: 'none', padding: '12px 16px', color: 'var(--foreground)', fontSize: 15, outline: 'none', fontFamily: 'var(--font-sans)' }} />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ background: 'var(--hpe-green)', border: 'none', color: 'white', width: 44, height: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s', opacity: loading || !input.trim() ? 0.5 : 1 }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
