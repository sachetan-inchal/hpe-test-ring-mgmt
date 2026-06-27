import { useEffect, useMemo, useRef, useState } from 'react'

function ToolCard({ title, subtitle, items }) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--foreground)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{subtitle}</div>}
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(items || []).map((it, idx) => (
          <div key={idx} style={{ fontSize: 12, color: 'var(--foreground)' }}>
            <span style={{ color: 'var(--hpe-green)', fontWeight: 700 }}>•</span> {it}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SANAutonomousAgentPage({ apiBase }) {
  const [query, setQuery] = useState('')
  const [arrayHint, setArrayHint] = useState('')
  const [running, setRunning] = useState(false)
  const [streamEvents, setStreamEvents] = useState([])
  const [finalResult, setFinalResult] = useState(null)
  const [error, setError] = useState(null)

  const esRef = useRef(null)

  const tools = useMemo(() => ([
    {
      title: 'Neo4j Cypher (read-only)',
      subtitle: 'Used when agent needs relationship-level answers.',
      items: [
        'Reads from Neo4j via /api/v1/san/rag/cypher or internal cypher runner',
        'Agent is expected to generate read-only Cypher only',
        'Results are summarized into final natural language answer'
      ]
    },
    {
      title: 'SSH Ops Tool (connect + exec)',
      subtitle: 'Used when agent must fetch latest device CLI data.',
      items: [
        'Connects to device using stored credentials (Mongo ssh_credentials) or provided credentials in connector layer',
        'Executes allowed “safe” CLI commands',
        'Concatenates stdout + stderr for parser compatibility'
      ]
    },
    {
      title: 'Simulator Exec (replay)',
      subtitle: 'Used for offline datasets and replay-based CLI outputs.',
      items: [
        'Runs commands against virtual_network simulator (replay datasets)',
        'Outputs are parsed by existing discovery/parsers',
        'Then persisted into Neo4j + Mongo (refresh/overwrite per device anchor)'
      ]
    },
    {
      title: 'Storage / Parsing',
      subtitle: 'Persists structured evidence so the agent can answer without hallucination.',
      items: [
        'Parses outputs using existing discovery/parsers and sim_parser',
        'Neo4j ingestion refreshes per ArraySystem/Host anchor',
        'Mongo ingestion reconciles run results into sandatas document'
      ]
    }
  ]), [])

  const startAgent = async () => {
    const q = (query || '').trim()
    if (!q) {
      setError('Query is required.')
      return
    }
    setError(null)
    setFinalResult(null)
    setStreamEvents([])
    setRunning(true)

    const url = new URL(`${apiBase}/api/agent/run/stream`)
    url.searchParams.set('query', q)
    if (arrayHint && arrayHint.trim()) url.searchParams.set('array', arrayHint.trim())
    url.searchParams.set('useOllama', 'false')
    url.searchParams.set('disableThink', 'false')

    try {
      const es = new EventSource(url.toString())
      esRef.current = es

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (!data) return
          if (data.type === 'error') {
            setError(data.error || 'Agent stream error')
            setRunning(false)
            es.close()
            return
          }
          if (data.type === 'final') {
            setFinalResult(data.result || data)
            setRunning(false)
            es.close()
            return
          }
          setStreamEvents((prev) => [...prev, data])
        } catch (e) {
          setStreamEvents((prev) => [...prev, { type: 'raw', content: evt.data }])
        }
      }

      es.onerror = () => {
        setError('SSE connection error. Check backend logs.')
        setRunning(false)
        try { es.close() } catch {}
      }
    } catch (e) {
      setError(e.message || String(e))
      setRunning(false)
    }
  }

  const stopAgent = () => {
    try {
      if (esRef.current) esRef.current.close()
    } catch {}
    esRef.current = null
    setRunning(false)
  }

  useEffect(() => {
    return () => {
      try {
        if (esRef.current) esRef.current.close()
      } catch {}
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 18 }}>
      <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--foreground)' }}>AUTONOMOUS AGENT</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Natural-language → tool calls → parsers → Neo4j/Mongo refresh → final answer. This page shows the agent “clockwork”.
        </div>
      </div>

      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>Natural language query</div>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={5}
                  placeholder='e.g. "List all arrays that are switchless"'
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    padding: 12,
                    borderRadius: 10,
                    border: '1px solid rgba(72,79,88,0.6)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--foreground)',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>Optional array hint</div>
                  <input
                    value={arrayHint}
                    onChange={(e) => setArrayHint(e.target.value)}
                    placeholder='Array name or IP (optional)'
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid rgba(72,79,88,0.6)',
                      background: 'rgba(255,255,255,0.04)',
                      color: 'var(--foreground)',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={startAgent}
                  disabled={running}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: 'none',
                    cursor: running ? 'not-allowed' : 'pointer',
                    background: running ? 'rgba(1,169,130,0.28)' : 'var(--hpe-green)',
                    color: 'white',
                    fontWeight: 900
                  }}
                >
                  {running ? 'Running…' : 'Run Autonomous Agent'}
                </button>
                <button
                  onClick={stopAgent}
                  disabled={!running}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(72,79,88,0.6)',
                    cursor: running ? 'pointer' : 'not-allowed',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--muted)',
                    fontWeight: 800
                  }}
                >
                  Stop
                </button>
              </div>

              {error && (
                <div style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(255, 80, 80, 0.45)', background: 'rgba(255, 80, 80, 0.08)', color: 'var(--foreground)' }}>
                  <div style={{ fontWeight: 900 }}>Error</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>{error}</div>
                </div>
              )}
            </div>
          </div>

          <div className="panel" style={{ padding: 16, flex: 1, minHeight: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--muted)' }}>Execution clockwork (SSE)</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{streamEvents.length} events</div>
            </div>

            <div style={{ marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
              {streamEvents.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>No events yet. Run the agent to see state-based tool steps.</div>
              ) : (
                streamEvents.map((e, idx) => (
                  <div key={idx} style={{ padding: '10px 0', borderBottom: '1px dashed rgba(72,79,88,0.25)' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--foreground)' }}>
                      {e.type || 'event'}
                    </div>
                    {e.step && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Step: {e.step}</div>}
                    {e.content && <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--foreground)', background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 10 }}>{e.content}</pre>}
                    {e.result && <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--foreground)', background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 10 }}>{JSON.stringify(e.result, null, 2)}</pre>}
                    {e.command && <div style={{ fontSize: 11, color: 'var(--foreground)', marginTop: 6 }}>Command: <span style={{ color: 'var(--accent-purple)', fontWeight: 900 }}>{e.command}</span></div>}
                    {(e.error && !e.content) && <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,120,120,0.95)' }}>{e.error}</div>}
                    {!e.content && !e.result && !e.step && !e.command && !e.error && (
                      <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--foreground)', background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 10 }}>
                        {JSON.stringify(e, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>

            {finalResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--muted)' }}>Final result</div>
                <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--foreground)', background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 12 }}>
                  {typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tools.map((t, idx) => (
            <ToolCard
              key={idx}
              title={t.title}
              subtitle={t.subtitle}
              items={t.items}
            />
          ))}

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--muted)' }}>Essential endpoints</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--foreground)' }}>
                <span style={{ color: 'var(--hpe-green)', fontWeight: 800 }}>•</span> Stream: <code style={{ color: 'var(--accent-purple)' }}>{apiBase}/api/agent/run/stream?query=…</code>
              </div>
              <div style={{ fontSize: 12, color: 'var(--foreground)' }}>
                <span style={{ color: 'var(--hpe-green)', fontWeight: 800 }}>•</span> Sync: <code style={{ color: 'var(--accent-purple)' }}>{apiBase}/api/agent/run</code>
              </div>
              <div style={{ fontSize: 12, color: 'var(--foreground)' }}>
                <span style={{ color: 'var(--hpe-green)', fontWeight: 800 }}>•</span> Cypher tool: runs via Neo4j runner (read-only in tool wrapper)
              </div>
              <div style={{ fontSize: 12, color: 'var(--foreground)' }}>
                <span style={{ color: 'var(--hpe-green)', fontWeight: 800 }}>•</span> CLI parsers: existing /api/parsers + discovery/parsers + sim_parser
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
