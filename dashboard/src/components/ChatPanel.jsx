import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'

function BlockRenderer({ block }) {
  if (block.type === 'markdown') {
    return (
      <div className="chat-md">
        <ReactMarkdown>{block.content || ''}</ReactMarkdown>
      </div>
    )
  }
  if (block.type === 'table' && block.headers?.length) {
    return (
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table className="chat-table">
          <thead>
            <tr>
              {block.headers.map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(block.rows || []).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (block.type === 'code') {
    return (
      <pre className="chat-code">
        <code>{block.content}</code>
      </pre>
    )
  }
  return null
}

export default function ChatPanel({ apiBase, open, onClose, seedMessage, onConsumedSeed }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const loadingRef = useRef(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const inputRef = useRef(input)
  inputRef.current = input

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = useCallback(async (text) => {
    const q = (text ?? inputRef.current).trim()
    if (!q || loadingRef.current) return
    setInput('')
    const history = messagesRef.current.flatMap(m => [
      { role: 'user', content: m.user },
      ...(m.assistant ? [{ role: 'assistant', content: m.assistant }] : []),
    ])
    setMessages(prev => [...prev, { user: q, assistant: null, blocks: [] }])
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, history }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last) last.assistant = data.error || 'Request failed'
          return next
        })
      } else {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last) {
            last.assistant = data.answer || ''
            last.blocks = data.render_blocks || []
          }
          return next
        })
      }
    } catch (e) {
      setMessages(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last) last.assistant = String(e.message || e)
        return next
      })
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    if (!open || !seedMessage?.trim()) return
    const q = seedMessage.trim()
    onConsumedSeed?.()
    send(q)
  }, [open, seedMessage, onConsumedSeed, send])

  if (!open) return null

  return (
    <aside
      className="chat-drawer"
      style={{
        width: 380,
        flexShrink: 0,
        background: 'var(--surface-1)',
        borderLeft: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13 }}>AI Assistant</span>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close chat">
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            Ask about arrays, hosts, drives, or Neo4j topology. Requires <code>GROQ_API_KEY</code> on the API.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="chat-bubble user">{m.user}</div>
            {m.assistant != null && (
              <div className="chat-bubble assistant">
                {m.blocks?.length
                  ? m.blocks.map((b, j) => <BlockRenderer key={j} block={b} />)
                  : m.assistant}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant" style={{ opacity: 0.8 }}>
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1, fontSize: 12 }}
            placeholder="Ask about the SAN…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          />
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => send()}>
            Send
          </button>
        </div>
      </div>
    </aside>
  )
}
