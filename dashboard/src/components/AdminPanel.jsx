import { useState, useRef } from 'react'

const LABELS = ['Host', 'Switch', 'ArraySystem', 'Cage', 'Node', 'PhysicalDisk']

export default function AdminPanel({ apiBase, open, onClose, selectedNode, allNodes, onGraphChanged }) {
  const [label, setLabel] = useState('Host')
  const [ip, setIp] = useState('')
  const [name, setName] = useState('')
  const [serial, setSerial] = useState('')
  const [cageId, setCageId] = useState('')
  const [nodeId, setNodeId] = useState('')
  const [arrayIp, setArrayIp] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [fakerName, setFakerName] = useState('synthetic_array')
  const fileRef = useRef(null)

  if (!open) return null

  const refresh = () => onGraphChanged?.()

  const doCreate = async () => {
    setBusy(true)
    setMsg('')
    try {
      const body = { label, connect_to_array_ip: arrayIp || undefined, properties: {} }
      if (label === 'Host') {
        body.ip_address = ip
        body.name = name || ip
      } else if (label === 'Switch') {
        body.name = name
        body.serial = serial || name
      } else if (label === 'ArraySystem') {
        body.ip_address = ip
        body.name = name || ip
      } else if (label === 'PhysicalDisk') {
        body.serial = serial
      } else if (label === 'Cage') {
        body.cage_id = cageId
        body.name = name || cageId
      } else if (label === 'Node') {
        body.node_id = nodeId
        body.name = name || nodeId
        if (!arrayIp) {
          setMsg('Node requires connect_to_array_ip')
          setBusy(false)
          return
        }
      }
      const res = await fetch(`${apiBase}/api/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setMsg(`Created: ${data.element_id}`)
      refresh()
    } catch (e) {
      setMsg(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const doDecommission = async (deco) => {
    if (!selectedNode?.id) {
      setMsg('Select a node on the canvas first')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`${apiBase}/api/graph/nodes/${encodeURIComponent(selectedNode.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDecommissioned: deco }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setMsg(deco ? 'Marked decommissioned' : 'Restored')
      refresh()
    } catch (e) {
      setMsg(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    const id = deleteId || selectedNode?.id
    if (!id) {
      setMsg('Enter element id or select a node')
      return
    }
    if (!window.confirm(`Delete node ${id}?`)) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`${apiBase}/api/graph/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setMsg('Deleted')
      setDeleteId('')
      refresh()
    } catch (e) {
      setMsg(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const decommissioned = allNodes.filter(n => n.is_decommissioned === true || n.isDecommissioned === true)

  const ingestCsv = async (file) => {
    if (!file) return
    setBusy(true)
    setMsg('')
    try {
      const text = await file.text()
      const res = await fetch(`${apiBase}/api/ingest/spreadsheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: text,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setMsg(`Ingest saved: ${data._saved || 'ok'}`)
    } catch (e) {
      setMsg(String(e.message || e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const runFaker = async () => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`${apiBase}/api/faker/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fakerName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setMsg(`Faker wrote: ${data.path}`)
    } catch (e) {
      setMsg(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(520px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--surface-1)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Topology admin</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>

        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Selected node</h3>
          <p style={{ fontSize: 12, margin: '0 0 8px' }}>
            {selectedNode ? `${selectedNode.name || selectedNode.id} (${selectedNode.type})` : 'None'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={busy || !selectedNode} onClick={() => doDecommission(true)}>
              Decommission
            </button>
            <button type="button" className="btn" disabled={busy || !selectedNode} onClick={() => doDecommission(false)}>
              Restore
            </button>
          </div>
        </section>

        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Add node</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select className="input" value={label} onChange={e => setLabel(e.target.value)}>
              {LABELS.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            {(label === 'Host' || label === 'ArraySystem') && (
              <input className="input" placeholder="ip_address" value={ip} onChange={e => setIp(e.target.value)} />
            )}
            {(label === 'Host' || label === 'Switch' || label === 'ArraySystem' || label === 'Cage' || label === 'Node') && (
              <input className="input" placeholder="name (optional)" value={name} onChange={e => setName(e.target.value)} />
            )}
            {(label === 'Switch' || label === 'PhysicalDisk') && (
              <input className="input" placeholder="serial" value={serial} onChange={e => setSerial(e.target.value)} />
            )}
            {label === 'Cage' && (
              <input className="input" placeholder="cage_id" value={cageId} onChange={e => setCageId(e.target.value)} />
            )}
            {label === 'Node' && (
              <input className="input" placeholder="node_id" value={nodeId} onChange={e => setNodeId(e.target.value)} />
            )}
            {(label === 'Host' || label === 'Switch' || label === 'Cage' || label === 'Node') && (
              <input className="input" placeholder="connect_to_array_ip (optional)" value={arrayIp} onChange={e => setArrayIp(e.target.value)} />
            )}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={doCreate}>Create</button>
          </div>
        </section>

        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Delete by element id</h3>
          <input
            className="input"
            placeholder="elementId (defaults to selection)"
            value={deleteId}
            onChange={e => setDeleteId(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <button type="button" className="btn" disabled={busy} onClick={doDelete}>Delete node</button>
        </section>

        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Spreadsheet ingest</h3>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ fontSize: 11, marginBottom: 8 }}
            onChange={e => ingestCsv(e.target.files?.[0])}
          />
        </section>

        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Synthetic device (CLI dump)</h3>
          <input className="input" placeholder="base name" value={fakerName} onChange={e => setFakerName(e.target.value)} style={{ marginBottom: 8 }} />
          <button type="button" className="btn" disabled={busy} onClick={runFaker}>Generate .txt</button>
        </section>

        <section>
          <h3 style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Decommissioned ({decommissioned.length})</h3>
          <ul style={{ fontSize: 11, maxHeight: 120, overflowY: 'auto', margin: 0, paddingLeft: 18 }}>
            {decommissioned.map(n => (
              <li key={n.id}>{n.name || n.id} — {n.type}</li>
            ))}
            {decommissioned.length === 0 && <li style={{ color: 'var(--muted)' }}>None</li>}
          </ul>
        </section>

        {msg && (
          <p style={{ marginTop: 12, fontSize: 12, color: msg.startsWith('Created') || msg.includes('Restored') ? 'var(--accent-green, #3fb950)' : 'var(--foreground)' }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  )
}
