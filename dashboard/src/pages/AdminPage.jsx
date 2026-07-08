import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, Upload, Wand2, Download, Database, FileJson, RefreshCw } from 'lucide-react'

const NODE_TYPES = ['Host', 'Switch', 'ArraySystem', 'Cage', 'Node', 'PhysicalDisk']

// SAN Fake Data Generator
function FakerSection({ apiBase }) {
  const [config, setConfig] = useState({ arrays: 2, switches: 2, hosts: 4, disks_per_array: 6, name_prefix: 'HPESYN' })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const generate = async () => {
    setBusy(true); setResult(null)
    try {
      const res = await fetch(`${apiBase}/api/faker/san`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (e) { setResult({ error: e.message }) } finally { setBusy(false) }
  }

  const download = () => {
    if (!result?.topology) return
    const blob = new Blob([JSON.stringify(result.topology, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `san_fake_${config.name_prefix}_${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const importToNeo4j = async () => {
    if (!result?.topology) return
    setBusy(true)
    try {
      const res = await fetch(`${apiBase}/api/faker/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.topology)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(prev => ({ ...prev, imported: true, importMsg: `Imported ${data.nodes_created} nodes, ${data.edges_created} edges` }))
    } catch (e) { setResult(prev => ({ ...prev, importMsg: `Error: ${e.message}` })) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Wand2 size={18} style={{ color: 'var(--hpe-green)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>SAN Fake Data Generator</h3>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
        Generate a fully consistent SAN topology with all node/edge types as a source-of-truth configuration.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { key: 'arrays', label: 'Arrays', min: 1 }, { key: 'switches', label: 'Switches', min: 1 },
          { key: 'hosts', label: 'Hosts', min: 1 }, { key: 'disks_per_array', label: 'Disks/Array', min: 2 },
        ].map(({ key, label, min }) => (
          <div key={key} className="form-group">
            <label>{label}</label>
            <input type="number" className="input" min={min} max={20} value={config[key]}
              onChange={e => setConfig(c => ({ ...c, [key]: parseInt(e.target.value) || min }))} />
          </div>
        ))}
        <div className="form-group">
          <label>Name Prefix</label>
          <input className="input" value={config.name_prefix} onChange={e => setConfig(c => ({ ...c, name_prefix: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          <Wand2 size={14} /> {busy ? 'Generating...' : 'Generate Topology'}
        </button>
        {result?.topology && <>
          <button className="btn" onClick={download}><Download size={14} /> Download JSON</button>
          <button className="btn btn-primary" onClick={importToNeo4j} disabled={busy}>
            <Database size={14} /> Import to Neo4j
          </button>
        </>}
      </div>
      {result && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          {result.error ? <span style={{ color: 'var(--accent-rose)' }}>{result.error}</span> :
            result.importMsg ? <span style={{ color: result.imported ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{result.importMsg}</span> :
            <span style={{ color: 'var(--status-ok)' }}>
              Generated: {result.topology?.nodes?.length} nodes, {result.topology?.edges?.length} edges — Click Download or Import to Neo4j
            </span>}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Log File Ingest Section
// ══════════════════════════════════════════════════════════════════════════════
function LogFileIngestSection({ apiBase }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [fileName, setFileName] = useState('')
  const [backups, setBackups] = useState([])
  const [backupsOpen, setBackupsOpen] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const progressRef = useRef(null)

  // Load backup list whenever the accordion opens
  useEffect(() => {
    if (!backupsOpen) return
    fetch(`${apiBase}/api/ingest/log/backups`)
      .then(r => r.json())
      .then(d => setBackups(d.backups || []))
      .catch(() => {})
  }, [backupsOpen, apiBase, result])

  const handleFile = async (file) => {
    if (!file) return
    setFileName(file.name)
    setError(null)
    setResult(null)
    setProgress(['⏳ Reading file…'])
    setBusy(true)

    const form = new FormData()
    form.append('file', file)

    try {
      setProgress(prev => [...prev, '📡 Sending to ingest API…'])
      const res = await fetch(`${apiBase}/api/ingest/log`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ingest failed')
      setProgress(prev => [...prev, `✓ Ingest complete — ${data.arrays_parsed} array(s) loaded in ${data.elapsed_sec}s`])
      setResult(data)
    } catch (e) {
      setError(e.message)
      setProgress(prev => [...prev, `✗ Error: ${e.message}`])
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRestore = async (backup_id) => {
    if (!window.confirm(`Restore backup "${backup_id}"?\n\nThis will WIPE current data and replace it with the backup snapshot.`)) return
    setRestoring(backup_id)
    try {
      const res = await fetch(`${apiBase}/api/ingest/log/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      alert(`✓ Restored:\n  Neo4j: ${data.restored?.neo4j_nodes ?? 0} nodes, ${data.restored?.neo4j_edges ?? 0} edges\n  MongoDB: ${data.restored?.mongo_nodes ?? 0} nodes\n  Elasticsearch: ${data.restored?.es_docs ?? 0} docs`)
      setResult(null)
      setProgress([])
    } catch (e) {
      alert(`✗ Restore failed: ${e.message}`)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="glass-card" style={{ padding: 24, gridColumn: '1 / -1' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'linear-gradient(135deg, var(--hpe-green) 0%, var(--accent-cyan) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 4px 14px rgba(1,169,130,0.35)',
        }}>
          <Upload size={20} color="#fff" />
        </div>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Ingest Log File</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Upload a terminal snapshot <code style={{ fontSize: 10, background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>.txt</code> or
            parsed array dump <code style={{ fontSize: 10, background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>.json</code>.
            Replaces all graph data — previous data is backed up automatically (reversible).
          </p>
        </div>
      </div>

      {/* ── Drop zone ── */}
      <div
        id="ingest-dropzone"
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
        onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
        onDrop={e => {
          e.preventDefault()
          e.currentTarget.classList.remove('drag-over')
          const f = e.dataTransfer.files?.[0]
          if (f) handleFile(f)
        }}
        onClick={() => !busy && fileRef.current?.click()}
        style={{
          marginTop: 16, marginBottom: 14,
          border: '2px dashed var(--line)',
          borderRadius: 14,
          padding: busy ? '20px' : '32px 20px',
          textAlign: 'center',
          cursor: busy ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          background: 'transparent',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
        />
        {busy ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div className="loading-spinner" style={{ width: 26, height: 26 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Ingesting <b>{fileName}</b>…</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Upload size={30} style={{ color: 'var(--hpe-green)', opacity: 0.75 }} />
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 0 }}>Drop .txt or .json here, or <span style={{ color: 'var(--hpe-green)', textDecoration: 'underline' }}>click to browse</span></p>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>
              TXT = raw terminal snapshot &nbsp;·&nbsp; JSON = pre-parsed array array
            </p>
          </div>
        )}
      </div>

      {/* ── Progress log ── */}
      {progress.length > 0 && (
        <div
          ref={progressRef}
          style={{
            marginBottom: 14, padding: '10px 14px',
            background: 'var(--surface-2)', borderRadius: 8,
            fontSize: 11, fontFamily: 'var(--font-mono)',
            maxHeight: 100, overflowY: 'auto',
            color: 'var(--foreground)', lineHeight: 1.8,
          }}
        >
          {progress.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248,81,73,0.25)',
          fontSize: 12, color: 'var(--accent-rose)',
        }}>
          ✗ {error}
        </div>
      )}

      {/* ── Success summary ── */}
      {result && !error && (
        <div style={{
          marginBottom: 14, padding: '14px 18px', borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(1,169,130,0.07) 0%, rgba(57,197,207,0.05) 100%)',
          border: '1px solid rgba(1,169,130,0.22)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>✓</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--hpe-green)' }}>
              {result.arrays_parsed} array{result.arrays_parsed !== 1 ? 's' : ''} ingested successfully
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
              {result.elapsed_sec}s · {result.mode?.toUpperCase() ?? ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(result.arrays || []).map((arr, i) => (
              <div key={i} style={{
                padding: '7px 12px', borderRadius: 8,
                background: 'var(--surface-1)',
                border: '1px solid var(--line)',
                fontSize: 11,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{arr.name || '(unnamed)'}</div>
                <div style={{ color: 'var(--muted)' }}>
                  {arr.model && <>{arr.model} · </>}
                  💽 {arr.drives ?? 0} drives · 🖥 {arr.hosts ?? 0} hosts · 🔌 {arr.ports ?? 0} ports
                </div>
              </div>
            ))}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--accent-amber)' }}>
              ⚠ {result.errors.length} warning(s): {result.errors.slice(0, 2).join(' · ')}
              {result.errors.length > 2 ? ` +${result.errors.length - 2} more` : ''}
            </div>
          )}
          {result.backup_id && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
              🗂 Backup: <code style={{ color: 'var(--accent-cyan)', fontSize: 10 }}>{result.backup_id}</code>
              &nbsp;— click "Backup History &amp; Restore" below to roll back
            </div>
          )}
        </div>
      )}

      {/* ── Backup / Restore accordion ── */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <button
          onClick={() => setBackupsOpen(o => !o)}
          style={{
            width: '100%', background: 'var(--surface-2)', border: 'none',
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
            cursor: 'pointer', color: 'var(--foreground)', fontSize: 13, fontWeight: 600,
            borderBottom: backupsOpen ? '1px solid var(--line)' : 'none',
          }}
        >
          <Database size={15} style={{ color: 'var(--accent-purple)' }} />
          Backup History &amp; Restore
          <span style={{
            marginLeft: 'auto', fontSize: 11, color: 'var(--muted)',
            transform: backupsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s', display: 'inline-block',
          }}>▼</span>
        </button>

        {backupsOpen && (
          <div style={{ padding: '12px 16px' }}>
            {backups.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>
                No backups yet — one is automatically created before every ingest operation.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {backups.map(b => (
                  <div key={b.backup_id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                        {b.backup_id}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {new Date(b.created_at).toLocaleString()} &nbsp;·&nbsp;
                        {b.neo4j_nodes} neo4j nodes, {b.neo4j_edges} edges &nbsp;·&nbsp;
                        {b.mongo_nodes} mongo nodes
                      </div>
                    </div>
                    <button
                      className="btn"
                      disabled={!!restoring}
                      onClick={() => handleRestore(b.backup_id)}
                      style={{ fontSize: 11, padding: '5px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {restoring === b.backup_id ? '↻ Restoring…' : '↺ Restore'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        #ingest-dropzone.drag-over {
          border-color: var(--hpe-green) !important;
          background: rgba(1,169,130,0.06) !important;
          transform: scale(1.01);
        }
      `}</style>
    </div>
  )
}

// Add Node Section (from AdminPanel, inline)
function AddNodeSection({ apiBase, onRefresh }) {
  const [label, setLabel] = useState('Host')
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const create = async () => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`${apiBase}/api/graph/nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, ...fields })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg(`✓ Created: ${data.element_id || data.id}`); setFields({}); onRefresh?.()
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Plus size={18} style={{ color: 'var(--accent-blue)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Add Node</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400 }}>
        <select className="input" value={label} onChange={e => setLabel(e.target.value)}>
          {NODE_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        {(label === 'Host' || label === 'ArraySystem') && (
          <input className="input" placeholder="IP Address" onChange={e => setFields(f => ({ ...f, ip_address: e.target.value }))} />
        )}
        <input className="input" placeholder="Name" onChange={e => setFields(f => ({ ...f, name: e.target.value }))} />
        {(label === 'Switch' || label === 'PhysicalDisk') && (
          <input className="input" placeholder="Serial Number" onChange={e => setFields(f => ({ ...f, serial: e.target.value }))} />
        )}
        <input className="input" placeholder="Connect to Array IP (optional)" onChange={e => setFields(f => ({ ...f, connect_to_array_ip: e.target.value || undefined }))} />
        <button className="btn btn-primary" disabled={busy} onClick={create}><Plus size={14} /> Create</button>
        {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
      </div>
    </div>
  )
}

// CSV Ingest Section
function CsvIngestSection({ apiBase }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const fileRef = useRef(null)
  const ingest = async (file) => {
    if (!file) return; setBusy(true); setMsg('')
    try {
      const text = await file.text()
      const res = await fetch(`${apiBase}/api/ingest/spreadsheet`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: text
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg(`✓ Ingested: ${data._saved || data.count || 'ok'} records`)
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return (
    <div className="glass-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Upload size={18} style={{ color: 'var(--accent-amber)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>CSV / Spreadsheet Ingest</h3>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Upload a CSV file with SAN device data to batch-import into Neo4j.</p>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" style={{ marginBottom: 10 }} onChange={e => ingest(e.target.files?.[0])} />
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
    </div>
  )
}

// Field Schema Section
function FieldSchemaSection({ apiBase }) {
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch(`${apiBase}/api/schema/fields`).then(r => r.json()).then(d => setRaw(JSON.stringify(d, null, 2))).catch(() => {})
  }, [apiBase])
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      let parsed = JSON.parse(raw)
      const res = await fetch(`${apiBase}/api/schema/fields`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg('✓ Schema saved')
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }
  return (
    <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <FileJson size={18} style={{ color: 'var(--accent-purple)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Field Schema Manager</h3>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Whitelisted property keys per node label. Edit JSON and save.</p>
      <textarea className="input" value={raw} onChange={e => setRaw(e.target.value)}
        style={{ minHeight: 200, fontFamily: 'var(--font-mono)', fontSize: 11, flex: 1 }} />
      {msg && <div style={{ fontSize: 12, margin: '8px 0', color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
      <button className="btn btn-primary" style={{ marginTop: 8, alignSelf: 'flex-start' }} disabled={busy} onClick={save}>Save Schema</button>
    </div>
  )
}

// Delete Node Section
function DeleteSection({ apiBase, allNodes, onRefresh }) {
  const [id, setId] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const del = async () => {
    if (!id || !window.confirm(`Delete ${id}?`)) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`${apiBase}/api/graph/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg('✓ Deleted'); setId(''); onRefresh?.()
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }
  return (
    <div className="glass-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Trash2 size={18} style={{ color: 'var(--accent-rose)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Delete Node</h3>
      </div>
      <div style={{ display: 'flex', gap: 8, maxWidth: 400 }}>
        <input className="input" placeholder="Element ID or node ID" value={id} onChange={e => setId(e.target.value)} list="node-ids" />
        <datalist id="node-ids">{allNodes.slice(0, 50).map(n => <option key={n.id} value={n.id} />)}</datalist>
        <button className="btn btn-danger" disabled={busy || !id} onClick={del}><Trash2 size={14} /></button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 8, color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
    </div>
  )
}

// Ontology Backup & Import Section
function OntologyBackupSection({ apiBase }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)

  const handleExport = async () => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`${apiBase}/api/ontology/export`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `ontology_topology_backup_${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
      setMsg('✓ Exported database.json configuration.')
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }

  const handleImport = async (file) => {
    if (!file) return
    setBusy(true); setMsg('')
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const res = await fetch(`${apiBase}/api/ontology/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg(`✓ ${data.message || 'Imported ontology successfully'}`)
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div className="glass-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Database size={18} style={{ color: 'var(--accent-purple)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Ontology Database Backup</h3>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Backup and restore the entire ontology topology database configuration (`database.json`).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn btn-primary" onClick={handleExport} disabled={busy}>
          <Download size={14} /> Export database.json
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Restore/Import configuration file:</label>
          <input ref={fileRef} type="file" accept=".json" className="input" onChange={e => handleImport(e.target.files?.[0])} />
        </div>
        {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
      </div>
    </div>
  )
}

// ====== Manage Teams Section ======
function ManageTeamsSection({ apiBase, onTeamChange }) {
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)
  const [editingTeam, setEditingTeam] = useState(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [newManagerUsername, setNewManagerUsername] = useState('')
  
  // Create Team Form State
  const [createName, setCreateName] = useState('')
  const [createManager, setCreateManager] = useState('')

  const [msg, setMsg] = useState('')

  const fetchTeams = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/teams`)
      const data = await res.json()
      setTeams(data.teams || [])
    } catch (e) {
      console.error('Failed to fetch teams', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTeams()
  }, [apiBase])

  const handleEditClick = (team) => {
    setEditingTeam(team)
    setNewTeamName(team.name)
    setNewManagerUsername(team.manager_username || '')
    setMsg('')
  }

  const handleCreateTeam = async (e) => {
    e.preventDefault()
    if (!createName.trim()) return
    setMsg('Creating team...')
    try {
      const res = await fetch(`${apiBase}/api/teams/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          manager_username: createManager.trim() || 'Test'
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Creation failed')
      setMsg('✓ Team created successfully')
      setCreateName('')
      setCreateManager('')
      fetchTeams()
      if (onTeamChange) onTeamChange()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!editingTeam) return
    setMsg('Updating...')
    try {
      const res = await fetch(`${apiBase}/api/teams/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_name: editingTeam.name,
          new_name: newTeamName,
          manager_username: newManagerUsername
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      setMsg('✓ Team updated successfully')
      setEditingTeam(null)
      fetchTeams()
      if (onTeamChange) onTeamChange()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    }
  }

  const handleDeleteTeam = async (teamName) => {
    if (!window.confirm(`Are you sure you want to delete team "${teamName}"?\nThis will remove it from all users and nodes.`)) return
    setMsg('Deleting...')
    try {
      const res = await fetch(`${apiBase}/api/teams/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setMsg(`✓ ${data.message || 'Team deleted successfully'}`)
      fetchTeams()
      if (onTeamChange) onTeamChange()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    }
  }

  return (
    <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>🗂️</span>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Manage & Create Teams</h3>
      </div>

      {/* Create Team Form */}
      <form onSubmit={handleCreateTeam} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>New Team Name</label>
          <input className="input" style={{ height: 32 }} placeholder="e.g. team-gamma" value={createName} onChange={e => setCreateName(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Manager Username (Optional)</label>
          <input className="input" style={{ height: 32 }} placeholder="e.g. Test" value={createManager} onChange={e => setCreateManager(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" style={{ height: 32, padding: '0 12px', fontSize: 12 }}>Create Team</button>
      </form>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading teams...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '200px', overflowY: 'auto' }}>
          {teams.map(t => (
            <div key={t.id || t.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Manager: {t.manager_name ? `${t.manager_name} (${t.manager_username})` : 'None'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => handleEditClick(t)}>Rename/Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDeleteTeam(t.name)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingTeam && (
        <form onSubmit={handleUpdate} style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Editing Team: {editingTeam.name}</h4>
          <div className="form-group">
            <label>Team Name</label>
            <input className="input" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Manager Username (current: {editingTeam.manager_username || 'None'})</label>
            <input className="input" placeholder="e.g. jdoe" value={newManagerUsername} onChange={e => setNewManagerUsername(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">Save Changes</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditingTeam(null)}>Cancel</button>
          </div>
        </form>
      )}

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
    </div>
  )
}

// ====== Manage Users Section ======
function ManageUsersSection({ apiBase, chatbotApi, refreshKey }) {
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [userRole, setUserRole] = useState('team_member')
  const [userTeam, setUserTeam] = useState('')
  const [userManagedTeams, setUserManagedTeams] = useState([])
  const [msg, setMsg] = useState('')

  const loadData = async () => {
    setLoading(true)
    try {
      const uRes = await fetch(`${chatbotApi}/auth/users`)
      const uData = await uRes.json()
      setUsers(uData.users || [])

      const tRes = await fetch(`${apiBase}/api/teams`)
      const tData = await tRes.json()
      setTeams(tData.teams || [])
    } catch (e) {
      console.error('Failed to load user management data', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (chatbotApi && apiBase) {
      loadData()
    }
  }, [chatbotApi, apiBase, refreshKey])

  const handleEditClick = (u) => {
    setEditingUser(u)
    setUserRole(u.role || 'team_member')
    setUserTeam(u.team || '')
    setUserManagedTeams(u.managedTeams || [])
    setMsg('')
  }

  const handleToggleManagedTeam = (tName) => {
    setUserManagedTeams(prev => 
      prev.includes(tName) ? prev.filter(x => x !== tName) : [...prev, tName]
    )
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!editingUser) return
    setMsg('Updating user...')
    try {
      const res = await fetch(`${chatbotApi}/auth/users/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser._id,
          role: userRole,
          team: userTeam,
          managedTeams: (userRole === 'manager' || userRole === 'director') ? userManagedTeams : []
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Update failed')
      setMsg('✓ User updated successfully')
      setEditingUser(null)
      loadData()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    }
  }

  return (
    <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>👥</span>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>User Scoping & Assignments</h3>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
        Assign users to teams, change roles, and assign managed teams for Managers/Directors.
      </p>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading users...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '250px', overflowY: 'auto' }}>
          {users.map(u => (
            <div key={u._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {u.name || u.username} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>({u.username})</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--hpe-green)', textTransform: 'capitalize', marginTop: 2 }}>
                  Role: <strong>{u.role?.replace('_', ' ')}</strong> | Team: <strong>{u.team || 'None'}</strong>
                </div>
                {u.managedTeams && u.managedTeams.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    Managed: {u.managedTeams.join(', ')}
                  </div>
                )}
              </div>
              <button className="btn btn-sm" onClick={() => handleEditClick(u)}>Edit Scope</button>
            </div>
          ))}
        </div>
      )}

      {editingUser && (
        <form onSubmit={handleSave} style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Assign Scope: {editingUser.name || editingUser.username}</h4>
          
          <div className="form-group">
            <label>Role</label>
            <select className="input" value={userRole} onChange={e => setUserRole(e.target.value)} style={{ background: '#161b22', color: '#fff' }}>
              <option value="team_member">Team Member</option>
              <option value="manager">Manager</option>
              <option value="director">Director</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <div className="form-group">
            <label>Primary Assigned Team</label>
            <select className="input" value={userTeam} onChange={e => setUserTeam(e.target.value)} style={{ background: '#161b22', color: '#fff' }}>
              <option value="">None</option>
              {teams.map(t => (
                <option key={t.id || t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {(userRole === 'manager' || userRole === 'director') && (
            <div className="form-group">
              <label style={{ marginBottom: 6, display: 'block' }}>Managed Teams (select multiple)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: 'rgba(0,0,0,0.1)', padding: 10, borderRadius: 6, border: '1px solid var(--line)' }}>
                {teams.map(t => (
                  <label key={t.id || t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={userManagedTeams.includes(t.name)}
                      onChange={() => handleToggleManagedTeam(t.name)}
                      style={{ accentColor: 'var(--hpe-green)' }}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">Save Assignments</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditingUser(null)}>Cancel</button>
          </div>
        </form>
      )}

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)' }}>{msg}</div>}
    </div>
  )
}

// ====== Manage Device Teams Section ======
function ManageDeviceTeamsSection({ apiBase, refreshKey, onTeamChange }) {
  const [devices, setDevices] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [selectedDevices, setSelectedDevices] = useState([])

  const loadData = async () => {
    setLoading(true)
    try {
      const dRes = await fetch(`${apiBase}/api/credentials/list`)
      const dData = await dRes.json()
      setDevices(dData.devices || [])

      const tRes = await fetch(`${apiBase}/api/teams`)
      const tData = await tRes.json()
      setTeams(tData.teams || [])
    } catch (e) {
      console.error('Failed to load device mapping data', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (apiBase) {
      loadData()
    }
  }, [apiBase, refreshKey])

  const handleDeviceClick = (e, device) => {
    if (e.shiftKey) {
      setSelectedDevices(prev => {
        const alreadySelected = prev.some(d => d.device_name === device.device_name)
        if (alreadySelected) {
          return prev.filter(d => d.device_name !== device.device_name)
        } else {
          return [...prev, device]
        }
      })
    } else {
      setSelectedDevices(prev => {
        const alreadySelected = prev.length === 1 && prev[0].device_name === device.device_name
        return alreadySelected ? [] : [device]
      })
    }
  }

  const handleDragStart = (e, device) => {
    // If the dragged device is not part of current selection, make it the only selected item
    let itemsToDrag = selectedDevices
    const isPart = selectedDevices.some(d => d.device_name === device.device_name)
    if (!isPart) {
      itemsToDrag = [device]
      setSelectedDevices([device])
    }
    e.dataTransfer.setData('text/plain', JSON.stringify(itemsToDrag))
  }

  const handleDrop = async (e, targetTeamName) => {
    e.preventDefault()
    try {
      const dataStr = e.dataTransfer.getData('text/plain')
      if (!dataStr) return
      const items = JSON.parse(dataStr)
      if (!Array.isArray(items) || items.length === 0) return

      setMsg(`Mapping ${items.length} devices to ${targetTeamName}...`)
      let successCount = 0

      for (const device of items) {
        if ((device.team || 'team-alpha') !== targetTeamName) {
          const res = await fetch(`${apiBase}/api/credentials/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...device,
              ip: device.ip_address || device.ip,
              team: targetTeamName
            })
          })
          if (res.ok) successCount++
        }
      }

      setMsg(`✓ Successfully mapped ${successCount} devices to ${targetTeamName}`)
      setSelectedDevices([])
      loadData()
      if (onTeamChange) onTeamChange() // Trigger refresh across other panels
    } catch (err) {
      setMsg(`✗ Drop failed: ${err.message}`)
    }
  }

  // Lane Colors based on index
  const getLaneColors = (index) => {
    const palettes = [
      { bg: 'var(--background)', border: 'var(--line)', text: 'var(--accent-blue)' },
      { bg: 'var(--background)', border: 'var(--line)', text: 'var(--accent-green)' },
      { bg: 'var(--background)', border: 'var(--line)', text: 'var(--accent-purple)' },
      { bg: 'var(--background)', border: 'var(--line)', text: 'var(--accent-orange)' },
      { bg: 'var(--background)', border: 'var(--line)', text: 'var(--accent-rose)' }
    ]
    return palettes[index % palettes.length]
  }

  return (
    <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔌</span>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Registered Device Team Mapping</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0 0' }}>
              Hold <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: 4, fontSize: 10 }}>Shift</kbd> to select multiple devices. Drag and drop to move them.
            </p>
          </div>
        </div>
        {selectedDevices.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--hpe-green)', fontWeight: 600, background: 'rgba(1,169,130,0.1)', padding: '4px 12px', borderRadius: 20, border: '1px solid rgba(1,169,130,0.2)' }}>
            {selectedDevices.length} Selected
          </span>
        )}
        {msg && (
          <div style={{
            fontSize: 12,
            padding: '4px 12px',
            borderRadius: 20,
            background: msg.startsWith('✓') ? 'rgba(46, 160, 67, 0.1)' : 'rgba(244, 63, 94, 0.1)',
            border: `1px solid ${msg.startsWith('✓') ? 'rgba(46, 160, 67, 0.2)' : 'rgba(244, 63, 94, 0.2)'}`,
            color: msg.startsWith('✓') ? 'var(--status-ok)' : 'var(--accent-rose)',
            transition: 'all 0.2s'
          }}>
            {msg}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading board...</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
          gap: 16,
          minHeight: 320,
          overflowX: 'auto',
          paddingBottom: 8
        }}>
          {teams.map((t, idx) => {
            const colors = getLaneColors(idx)
            const teamDevices = devices.filter(d => (d.team || 'team-alpha') === t.name)

            return (
              <div
                key={t.id || t.name}
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)' }}
                onDragLeave={(e) => { e.currentTarget.style.background = colors.bg }}
                onDrop={(e) => handleDrop(e, t.name)}
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  transition: 'background 0.2s ease, transform 0.2s ease'
                }}
              >
                {/* Column Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{t.name}</span>
                  <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 10, fontWeight: 500 }}>
                    {teamDevices.length}
                  </span>
                </div>

                {/* Column Content */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 180 }}>
                  {teamDevices.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, border: '1px dashed rgba(255,255,255,0.05)', borderRadius: 8, color: 'var(--muted)', fontSize: 11, minHeight: 120 }}>
                      Drop devices here
                    </div>
                  ) : (
                    teamDevices.map((d, dIdx) => {
                      const isSelected = selectedDevices.some(sel => sel.device_name === d.device_name)
                      return (
                        <div
                          key={dIdx}
                          draggable
                          onDragStart={(e) => handleDragStart(e, d)}
                          onDragEnd={(e) => {
                            e.currentTarget.style.opacity = '1'
                          }}
                          onClick={(e) => handleDeviceClick(e, d)}
                          style={{
                            background: isSelected ? 'rgba(1, 169, 130, 0.15)' : 'var(--surface-1)',
                            border: isSelected ? '1px solid var(--hpe-green)' : '1px solid var(--line)',
                            boxShadow: isSelected ? '0 0 12px rgba(1, 169, 130, 0.25)' : '0 2px 8px rgba(0,0,0,0.15)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            cursor: 'grab',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.borderColor = colors.text
                              e.currentTarget.style.transform = 'translateY(-1px)'
                              e.currentTarget.style.background = 'var(--surface-3)'
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.borderColor = 'var(--line)'
                              e.currentTarget.style.transform = 'none'
                              e.currentTarget.style.background = 'var(--surface-1)'
                            }
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>{d.device_name}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{d.ip_address || d.ip || 'DNS'}</span>
                            <span style={{
                              fontSize: 9,
                              background: d.device_kind === 'mock' ? 'rgba(57,197,207,0.1)' : 'rgba(1,169,130,0.1)',
                              color: d.device_kind === 'mock' ? '#39c5cf' : '#01a982',
                              padding: '1px 5px',
                              borderRadius: 4,
                              fontWeight: 600,
                              textTransform: 'uppercase'
                            }}>
                              {d.device_kind || 'real'}
                            </span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ====== Main Admin Page ======
export default function AdminPage({ apiBase, chatbotApi }) {
  const [allNodes, setAllNodes] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [visible, setVisible] = useState(true)
  const refresh = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    fetch(`${apiBase}/api/graph/mongo`).then(r => r.json())
      .then(d => setAllNodes((d.nodes || []).map(n => ({ id: n.data?.id || n.id, name: n.data?.name || n.name || n.data?.id || n.id, type: n.data?.label || n.type }))))
      .catch(() => {})
  }, [apiBase, refreshKey])

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      {visible && (
        <>
          <div className="page-header">
            <div>
              <h2 className="page-title">Admin & Configuration</h2>
              <p className="page-subtitle">Manage nodes, schema, data import, and synthetic data generation</p>
            </div>
            <button className="btn" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <ManageTeamsSection apiBase={apiBase} onTeamChange={refresh} />
            <ManageUsersSection apiBase={apiBase} chatbotApi={chatbotApi} refreshKey={refreshKey} />
            <ManageDeviceTeamsSection apiBase={apiBase} refreshKey={refreshKey} onTeamChange={refresh} />
          </div>
        </>
      )}

      {/* Bottom right small switch with no name */}
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
        <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18 }}>
          <input 
            type="checkbox" 
            checked={visible} 
            onChange={() => setVisible(!visible)} 
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: visible ? 'var(--hpe-green, #01a982)' : 'rgba(255, 255, 255, 0.15)',
            border: '1px solid var(--line, rgba(255, 255, 255, 0.15))',
            transition: 'background-color 0.2s, border-color 0.2s', borderRadius: 20
          }}>
            <span style={{
              position: 'absolute', height: 12, width: 12, left: 2, bottom: 2,
              backgroundColor: 'white', transition: 'transform 0.2s', borderRadius: '50%',
              transform: visible ? 'translateX(16px)' : 'none'
            }} />
          </span>
        </label>
      </div>
    </div>
  )
}
