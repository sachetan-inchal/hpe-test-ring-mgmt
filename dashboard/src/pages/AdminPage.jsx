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

// ====== Main Admin Page ======
export default function AdminPage({ apiBase }) {
  const [allNodes, setAllNodes] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    fetch(`${apiBase}/api/graph/neo4j`).then(r => r.json())
      .then(d => setAllNodes((d.nodes || []).map(n => ({ id: n.data?.id || n.id, name: n.data?.name || n.name, type: n.data?.label || n.type }))))
      .catch(() => {})
  }, [apiBase, refreshKey])

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Admin & Configuration</h2>
          <p className="page-subtitle">Manage nodes, schema, data import, and synthetic data generation</p>
        </div>
        <button className="btn" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {/* Full-width log ingest section always first */}
        <LogFileIngestSection apiBase={apiBase} />
        <FakerSection apiBase={apiBase} />
        <AddNodeSection apiBase={apiBase} onRefresh={refresh} />
        <CsvIngestSection apiBase={apiBase} />
        <FieldSchemaSection apiBase={apiBase} />
        <OntologyBackupSection apiBase={apiBase} />
        <DeleteSection apiBase={apiBase} allNodes={allNodes} onRefresh={refresh} />
      </div>
    </div>
  )
}
