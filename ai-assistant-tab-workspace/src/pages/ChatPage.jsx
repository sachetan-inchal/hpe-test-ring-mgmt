// Standalone copy (simplified) of the AI Assistant tab.
// For full parity with the dashboard version, copy the entire file from dashboard/src/pages/ChatPage.jsx.

import { useState, useContext } from 'react'
import { AuthContext } from '../context/AuthContextShim'
import RadialMenu from '../components/RadialMenu'

export default function ChatPage({ apiBase, chatbotApi }) {
  const { user } = useContext(AuthContext)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || loading) return
    setInput('')
    setLoading(true)
    setMessages(prev => [...prev, { role: 'user', text: q }, { role: 'assistant', text: '' , pending:true }])

    try {
      // Minimal fallback: call chatbot service (standard mode).
      const res = await fetch(`${chatbotApi}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' , ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
        body: JSON.stringify({ message: q, history: [] })
      })
      const data = await res.json()
      const answer = data.response || data.answer || data.message || 'No response from backend.'
      setMessages(prev => {
        const next = [...prev]
        const idx = next.findIndex(m => m.pending)
        if (idx !== -1) next[idx] = { role: 'assistant', text: answer }
        return next
      })
    } catch (e) {
      setMessages(prev => {
        const next = [...prev]
        const idx = next.findIndex(m => m.pending)
        if (idx !== -1) next[idx] = { role: 'assistant', text: `Error: ${e?.message || e}` }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--hpe-green)' }} />
        <span style={{ fontWeight: 700 }}>HPE SAN AI Assistant (Workspace)</span>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {messages.length === 0 && (
          <div style={{ maxWidth: 720, margin: '20px auto', textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Hello, {user?.username || 'there'}! 👋</h2>
            <p style={{ marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>
              Use the quick query wheel below or type freely.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <RadialMenu onSend={(text) => send(text)} />
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 14, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '85%',
                padding: '12px 14px',
                borderRadius: 12,
                background: m.role === 'user' ? 'rgba(1,169,130,0.12)' : 'var(--surface-2)',
                border: `1px solid ${m.role === 'user' ? 'rgba(1,169,130,0.25)' : 'var(--border-color)'}`,
                color: 'var(--text-main)',
                whiteSpace: 'pre-wrap',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {m.text || (m.pending ? 'Thinking…' : '')}
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', padding: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={1}
            style={{ flex: 1, resize: 'none', borderRadius: 10, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.04)', padding: '10px 12px', color: 'var(--foreground)', fontSize: 14 }}
            placeholder='Ask about your SAN...'
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{ width: 44, height: 44, borderRadius: 10, border: 'none', background: 'var(--hpe-green)', color: 'white', cursor: !input.trim() || loading ? 'not-allowed' : 'pointer', fontWeight: 800 }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}

