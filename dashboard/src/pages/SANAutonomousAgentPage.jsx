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

    let safeBase = apiBase || window.location.origin
    if (!safeBase.startsWith('http')) {
      safeBase = window.location.origin + (safeBase.startsWith('/') ? '' : '/') + safeBase
    }
    
    // Clean up trailing slash
    if (safeBase.endsWith('/')) {
      safeBase = safeBase.slice(0, -1)
    }

    const url = new URL(`${safeBase}/api/agent/run/stream`)
    url.searchParams.set('query', q)
    if (arrayHint && arrayHint.trim()) url.searchParams.set('array', arrayHint.trim())
    url.searchParams.set('useOllama', 'true')
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

  // Process stream events to calculate dynamic states
  const steps = useMemo(() => {
    return streamEvents.filter(e => e.type === 'step').map(e => e.step)
  }, [streamEvents])

  const currentScratchpad = useMemo(() => {
    // Look for steps carrying parsed facts or synthesis planning blocks
    const finalSteps = steps.filter(s => s.type === 'parsed' || s.parsed_preview)
    if (finalSteps.length === 0) return null
    return finalSteps[finalSteps.length - 1].parsed_preview
  }, [steps])

  const runningText = useMemo(() => {
    return streamEvents
      .filter(e => e.type === 'synthesis')
      .map(e => e.content)
      .join('')
  }, [streamEvents])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 18 }}>
      <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--foreground)' }}>AUTONOMOUS AGENT (QWEN3:4B OLLAMA)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Autonomous ReAct loops targeting live SSH-enabled switches and arrays. Utilizes local Ollama for parsing, cypher generation, and diagnostics.
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
                  rows={3}
                  placeholder='e.g. "Check the health of cage components on array PROD-A"'
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
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>Optional target array/device hint</div>
                  <input
                    value={arrayHint}
                    onChange={(e) => setArrayHint(e.target.value)}
                    placeholder='e.g. PROD-A'
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
                  {running ? 'Running agent with Ollama Qwen3:4b…' : 'Run Autonomous Agent'}
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

          {/* STREAMING SYNTHESIS / FINAL RESPONSE */}
          {(runningText || finalResult) && (
            <div className="panel" style={{ padding: 16, border: '1px solid rgba(1, 169, 130, 0.3)', background: 'rgba(1, 169, 130, 0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--hpe-green)' }}>
                  {running ? 'Streaming Agent Report...' : 'Final Synthesis Report'}
                </div>
                {running && <span className="streaming-indicator" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--hpe-green)' }} />}
              </div>
              <div style={{ marginTop: 12, fontSize: 13, lineHeight: '1.6', color: 'var(--foreground)', whiteSpace: 'pre-wrap' }}>
                {runningText || (finalResult && (typeof finalResult === 'string' ? finalResult : finalResult.result || JSON.stringify(finalResult, null, 2)))}
              </div>
            </div>
          )}

          {/* ACTIVE TOOL EXECUTION TRACE */}
          {steps.length > 0 && (
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--muted)', marginBottom: 12 }}>
                Active Agent Clockwork & Tool Execution Pipeline
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {steps.map((s, idx) => (
                  <div key={idx} style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--foreground)' }}>
                        Step {s.id}: {s.title || 'Tool Invocation'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {s.timestamp} | <span style={{ color: s.type === 'error' ? 'red' : 'var(--hpe-green)' }}>{s.type}</span>
                      </span>
                    </div>
                    {s.detail && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        {s.detail}
                      </div>
                    )}
                    {s.command && (
                      <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#121214', border: '1px solid #232326' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent-purple)', marginBottom: 4 }}>SSH Connector Payload:</div>
                        <code style={{ fontSize: 11, color: '#f8f8f2' }}>{s.command}</code>
                      </div>
                    )}
                    {s.command_output && (
                      <div style={{ marginTop: 6 }}>
                        <details>
                          <summary style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}>View Raw SSH Execution Result</summary>
                          <pre style={{ fontSize: 10, background: '#18181f', padding: 8, borderRadius: 6, marginTop: 4, overflowX: 'auto', maxHeight: 150 }}>{s.command_output}</pre>
                        </details>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

          <div className="panel" style={{ padding: 16, flex: 1, minHeight: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--foreground)' }}>LangGraph State & Memory Workspace</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{streamEvents.length} events logged</div>
            </div>

            {/* TEMPORARY MEMORY & SCRATCHPAD VIEW */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', tracking: 1 }}>Active Scratchpad (Context Facts)</div>
              {currentScratchpad ? (
                <div style={{ marginTop: 8, padding: 12, borderRadius: 8, background: 'rgba(1,169,130,0.05)', border: '1px dashed var(--hpe-green)' }}>
                  <pre style={{ margin: 0, fontSize: 11, color: 'var(--foreground)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {JSON.stringify(currentScratchpad, null, 2)}
                  </pre>
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                  No facts structured in scratchpad yet. Parser will dump metrics here once CLI tools execute.
                </div>
              )}
            </div>

            {/* SSE LOGS / STEP STATE HISTORY */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', tracking: 1, marginBottom: 8 }}>Raw SSE Logs</div>
              <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {streamEvents.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Awaiting stream handshake...</div>
                ) : (
                  streamEvents.map((e, idx) => (
                    <div key={idx} style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', fontSize: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong style={{ color: 'var(--accent-purple)' }}>{e.type.toUpperCase()}</strong>
                        {e.step && <span style={{ color: 'var(--muted)' }}>Step #{e.step}</span>}
                      </div>
                      {e.content && <div style={{ marginTop: 4, color: 'var(--foreground)', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{e.content}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>

            {finalResult && (
              <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Raw Execution Package</div>
                <details>
                  <summary style={{ fontSize: 11, color: 'var(--hpe-green)', cursor: 'pointer' }}>View full payload result</summary>
                  <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 10, color: 'var(--foreground)', background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
                    {JSON.stringify(finalResult, null, 2)}
                  </pre>
                </details>
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
