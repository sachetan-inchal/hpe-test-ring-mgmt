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
        <FakerSection apiBase={apiBase} />
        <AddNodeSection apiBase={apiBase} onRefresh={refresh} />
        <CsvIngestSection apiBase={apiBase} />
        <FieldSchemaSection apiBase={apiBase} />
        <DeleteSection apiBase={apiBase} allNodes={allNodes} onRefresh={refresh} />
      </div>
    </div>
  )
}
