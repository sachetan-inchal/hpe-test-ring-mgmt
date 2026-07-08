import { useState, useEffect } from 'react'
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, RefreshCw, Database, Terminal, Cpu, HardDrive, ArrowRight, TerminalSquare, Copy, Check } from 'lucide-react'

export default function ServiceTesterPage({ apiBase }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Traced fetch actions
  const [logs, setLogs] = useState(() => (typeof window !== 'undefined' ? window.__api_logs || [] : []))
  
  // Real backend server console logs
  const [serverLogs, setServerLogs] = useState('Fetching server console output...')
  const [serverLogsLoading, setServerLogsLoading] = useState(false)
  const [copiedLogs, setCopiedLogs] = useState(false)

  const fetchStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/service-tester/status`)
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`)
      const data = await res.json()
      setStatus(data)
    } catch (err) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchServerLogs = async () => {
    setServerLogsLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/service-tester/server-logs`)
      if (res.ok) {
        const data = await res.json()
        setServerLogs(data.logs || 'No server console logs available.')
      } else {
        setServerLogs(`Error fetching logs: status code ${res.status}`)
      }
    } catch (err) {
      setServerLogs(`Error fetching logs: ${err.message}`)
    } finally {
      setServerLogsLoading(false)
    }
  }

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(serverLogs)
    setCopiedLogs(true)
    setTimeout(() => setCopiedLogs(false), 2000)
  }

  useEffect(() => {
    fetchStatus()
    fetchServerLogs()

    // Listen for global action logs updates
    const handleLogUpdate = () => {
      setLogs([...(window.__api_logs || [])])
    }
    window.addEventListener('api_log_updated', handleLogUpdate)
    return () => {
      window.removeEventListener('api_log_updated', handleLogUpdate)
    }
  }, [apiBase])

  const runAllDiagnostics = () => {
    fetchStatus()
    fetchServerLogs()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', overflowY: 'auto', paddingBottom: 40 }}>
      
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Service & Dependency Tester
            <span style={{ fontSize: 10, background: 'var(--surface-1)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--line)' }}>
              Diagnostics
            </span>
          </h2>
          <p className="page-subtitle">Verify status of databases, system paths, python packages, and the V8 sandbox engine</p>
        </div>

        <button 
          onClick={runAllDiagnostics}
          disabled={loading || serverLogsLoading}
          className="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 10,
            cursor: (loading || serverLogsLoading) ? 'not-allowed' : 'pointer',
            background: 'var(--foreground)',
            color: 'var(--background)',
            fontWeight: 600,
            border: 'none',
            boxShadow: '0 4px 14px rgba(255,255,255,0.08)'
          }}
        >
          <RefreshCw size={15} style={{ animation: (loading || serverLogsLoading) ? 'spin 1s linear infinite' : 'none' }} />
          {loading || serverLogsLoading ? 'Running Diagnostics...' : 'Refresh Status'}
        </button>
      </div>

      {error && (
        <div className="glass-card" style={{ padding: 16, border: '1px solid var(--accent-red)', background: 'rgba(255,69,58,0.05)', borderRadius: 10 }}>
          <h4 style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <ShieldAlert size={18} /> API Diagnostics Request Failed
          </h4>
          <p style={{ margin: '8px 0 0 0', fontSize: 13, color: 'var(--muted)' }}>{error}</p>
        </div>
      )}

      {/* ── PIPELINE FLOW VISUALIZATION ── */}
      <div className="glass-card" style={{ padding: 24, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12 }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 15, fontWeight: 600, color: 'var(--foreground)' }}>
          Data Discovery Pipeline & Connectivity Path
        </h3>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16, padding: '16px 0' }}>
          
          {/* Poller */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 150 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(58,166,255,0.1)', border: '2px solid #58a6ff', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#58a6ff' }}>
              <Terminal size={24} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>1. Poller</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>SSH Connection (paramiko)</span>
            <span style={{ 
              fontSize: 10, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
              background: status?.python_libraries?.paramiko === 'available' ? 'rgba(46,160,67,0.1)' : 'rgba(255,69,58,0.1)',
              color: status?.python_libraries?.paramiko === 'available' ? '#2ea043' : '#ff453a'
            }}>
              {status?.python_libraries?.paramiko === 'available' ? 'Ready' : 'Library Missing'}
            </span>
          </div>

          <ArrowRight size={24} style={{ color: 'var(--line)' }} />

          {/* Parser */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 150 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(163,113,247,0.1)', border: '2px solid #a371f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a371f7' }}>
              <Cpu size={24} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>2. Parser Engine</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Node V8 Sandbox</span>
            <span style={{ 
              fontSize: 10, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
              background: status?.v8_parser_status?.status === 'working' ? 'rgba(46,160,67,0.1)' : 'rgba(255,159,64,0.1)',
              color: status?.v8_parser_status?.status === 'working' ? '#2ea043' : '#ff9f40'
            }}>
              {status?.v8_parser_status?.status === 'working' ? 'Functional' : 'Blocked'}
            </span>
          </div>

          <ArrowRight size={24} style={{ color: 'var(--line)' }} />

          {/* Databases */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 150 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(46,160,67,0.1)', border: '2px solid #2ea043', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2ea043' }}>
              <Database size={24} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>3. Storage Layer</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>MongoDB & Neo4j</span>
            <span style={{ 
              fontSize: 10, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
              background: (status?.services?.mongodb === 'connected' && status?.services?.neo4j === 'connected') ? 'rgba(46,160,67,0.1)' : 'rgba(255,69,58,0.1)',
              color: (status?.services?.mongodb === 'connected' && status?.services?.neo4j === 'connected') ? '#2ea043' : '#ff453a'
            }}>
              {status?.services?.mongodb === 'connected' && status?.services?.neo4j === 'connected' ? 'Connected' : 'DB Disconnected'}
            </span>
          </div>

        </div>
      </div>

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          
          {/* Node JS V8 Parser Diagnosis Card */}
          <div className="glass-card" style={{ padding: 20, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 8, background: 'rgba(58,166,255,0.1)', color: '#58a6ff', borderRadius: 8 }}>
                <Cpu size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Node JS V8 Parser Engine</h3>
            </div>
            
            <div style={{
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              padding: 16, 
              borderRadius: 10, 
              background: status.v8_parser_status.status === 'working' ? 'rgba(46,160,67,0.06)' : 'rgba(255,159,64,0.06)',
              border: `1px solid ${status.v8_parser_status.status === 'working' ? 'rgba(46,160,67,0.2)' : 'rgba(255,159,64,0.2)'}`
            }}>
              {status.v8_parser_status.status === 'working' ? (
                <ShieldCheck size={32} style={{ color: '#2ea043' }} />
              ) : (
                <ShieldAlert size={32} style={{ color: '#ff9f40' }} />
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {status.v8_parser_status.status === 'working' ? 'Engine Fully Functional' : 'V8 Engine Blocked/Missing'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  Status code: {status.v8_parser_status.status}
                </div>
              </div>
            </div>

            {status.v8_parser_status.error && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>DIAGNOSTICS / ERROR LOG:</span>
                <pre style={{ margin: 0, padding: 12, background: 'var(--background)', borderRadius: 8, border: '1px solid var(--line)', fontSize: 11, overflowX: 'auto', color: 'var(--accent-red)', whiteSpace: 'pre-wrap' }}>
                  {status.v8_parser_status.error}
                </pre>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><strong>V8 Wrapper Script Path:</strong></div>
              <code style={{ fontSize: 11, background: 'var(--background)', padding: '4px 8px', borderRadius: 4, wordBreak: 'break-all' }}>
                {status.v8_parser_status.script_path}
              </code>
            </div>
          </div>

          {/* Services & Databases (Excluding Elasticsearch) */}
          <div className="glass-card" style={{ padding: 20, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 8, background: 'rgba(163,113,247,0.1)', color: '#a371f7', borderRadius: 8 }}>
                <Database size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Databases & Infras</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(status.services).map(([service, state]) => (
                <div key={service} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--background)', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <span style={{ textTransform: 'capitalize', fontSize: 13, fontWeight: 500 }}>{service}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ 
                      width: 8, height: 8, borderRadius: '50%', 
                      background: state === 'connected' ? '#2ea043' : '#ff453a',
                      boxShadow: state === 'connected' ? '0 0 8px #2ea043' : '0 0 8px #ff453a'
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: state === 'connected' ? '#2ea043' : '#ff453a', textTransform: 'uppercase' }}>
                      {state}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* System Binaries (Excluding Docker) */}
          <div className="glass-card" style={{ padding: 20, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 8, background: 'rgba(255,159,64,0.1)', color: '#ff9f40', borderRadius: 8 }}>
                <Terminal size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>System Path Binaries</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(status.system_binaries).map(([bin, details]) => (
                <div key={bin} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'var(--background)', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--muted)' }}>{bin}</span>
                    <span style={{ 
                      fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                      background: details.status === 'available' ? 'rgba(46,160,67,0.1)' : 'rgba(255,69,58,0.1)',
                      color: details.status === 'available' ? '#2ea043' : '#ff453a',
                      border: `1px solid ${details.status === 'available' ? 'rgba(46,160,67,0.2)' : 'rgba(255,69,58,0.2)'}`
                    }}>
                      {details.status}
                    </span>
                  </div>
                  {details.status === 'available' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                      <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>
                        <strong>Path:</strong> {details.path}
                      </div>
                      <div style={{ color: 'var(--muted)' }}>
                        <strong>Version:</strong> {details.version}
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Binary was not found in the environment's PATH.</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Python Libraries (Excluding Elasticsearch and Groq) */}
          <div className="glass-card" style={{ padding: 20, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 8, background: 'rgba(255,69,58,0.1)', color: '#ff453a', borderRadius: 8 }}>
                <HardDrive size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Python Package Modules</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              {Object.entries(status.python_libraries).map(([lib, state]) => (
                <div key={lib} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--background)', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{lib}</span>
                  {state === 'available' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2ea043', fontSize: 11, fontWeight: 600 }}>
                      <CheckCircle2 size={14} /> Installed
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ff453a', fontSize: 11, fontWeight: 600 }}>
                      <XCircle size={14} /> Missing
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── SERVER CONSOLE LOGS (npm start output) ── */}
      <div className="glass-card" style={{ padding: 24, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 8, background: 'rgba(255,159,64,0.1)', color: '#ff9f40', borderRadius: 8 }}>
              <Terminal size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Server Console Output (npm start logs)</h3>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>Direct stdout/stderr logs from the backend API daemon and worker threads</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button 
              onClick={handleCopyLogs}
              style={{ 
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 12px', 
                background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer', color: 'var(--foreground)' 
              }}
            >
              {copiedLogs ? <Check size={13} style={{ color: '#2ea043' }} /> : <Copy size={13} />}
              {copiedLogs ? 'Copied!' : 'Copy Logs'}
            </button>
            <button 
              onClick={fetchServerLogs}
              disabled={serverLogsLoading}
              style={{ 
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 12px', 
                background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, cursor: serverLogsLoading ? 'not-allowed' : 'pointer', color: 'var(--foreground)' 
              }}
            >
              <RefreshCw size={13} style={{ animation: serverLogsLoading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>

        <div style={{ 
          height: 280, 
          overflowY: 'auto', 
          background: '#0d1117', 
          borderRadius: 10, 
          border: '1px solid var(--line)', 
          padding: 16,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#8b949e',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.4'
        }}>
          {serverLogs}
        </div>
      </div>

      {/* ── APPLICATION ACTION & CONNECTIVITY TRACER ── */}
      <div className="glass-card" style={{ padding: 24, border: '1px solid var(--line)', background: 'var(--surface-1)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 8, background: 'rgba(88,166,255,0.1)', color: '#58a6ff', borderRadius: 8 }}>
              <TerminalSquare size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Application Action & Connectivity Tracer</h3>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>Intercepts and highlights live app actions and request paths</p>
            </div>
          </div>
          <button 
            onClick={() => {
              if (typeof window !== 'undefined') window.__api_logs = [];
              setLogs([]);
            }}
            style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted)' }}
          >
            Clear Log
          </button>
        </div>

        <div style={{ 
          height: 240, 
          overflowY: 'auto', 
          background: '#0d1117', 
          borderRadius: 10, 
          border: '1px solid var(--line)', 
          padding: 16,
          fontFamily: 'monospace',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '80px 0' }}>
              No application actions traced yet. Click any button in the app to see live API traffic.
            </div>
          ) : (
            logs.map(log => (
              <div 
                key={log.id} 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 4, 
                  paddingBottom: 10, 
                  borderBottom: '1px solid rgba(255,255,255,0.05)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ 
                      padding: '2px 6px', 
                      borderRadius: 4, 
                      fontSize: 10, 
                      fontWeight: 700, 
                      background: log.method === 'GET' ? 'rgba(58,166,255,0.15)' : 'rgba(163,113,247,0.15)',
                      color: log.method === 'GET' ? '#58a6ff' : '#a371f7' 
                    }}>
                      {log.method}
                    </span>
                    <span style={{ color: '#e6edf3', wordBreak: 'break-all' }}>{log.url}</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 10 }}>{log.timestamp}</span>
                    <span style={{ 
                      padding: '2px 8px', 
                      borderRadius: 12, 
                      fontSize: 10, 
                      fontWeight: 700,
                      background: log.status === 'success' ? 'rgba(46,160,67,0.15)' : log.status === 'failure' ? 'rgba(255,69,58,0.15)' : 'rgba(255,159,64,0.15)',
                      color: log.status === 'success' ? '#2ea043' : log.status === 'failure' ? '#ff453a' : '#ff9f40'
                    }}>
                      {log.status === 'pending' ? 'PENDING...' : log.statusCode ? `HTTP ${log.statusCode}` : 'FAILED'}
                    </span>
                  </div>
                </div>
                {log.error && (
                  <div style={{ color: '#ff453a', fontSize: 11, paddingLeft: 16 }}>
                    Error: {log.error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Spin Animation Definition */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
