import { useState, useEffect } from 'react'

export default function FieldManager({ apiBase, open, onClose }) {
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`${apiBase}/api/schema/fields`)
      .then(r => r.json())
      .then(d => {
        setRaw(JSON.stringify(d, null, 2))
        setErr('')
      })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [open, apiBase])

  if (!open) return null

  const save = async () => {
    setErr('')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      setErr('Invalid JSON')
      return
    }
    if (typeof parsed !== 'object' || parsed === null) {
      setErr('Root must be an object')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/schema/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || res.statusText)
      setRaw(JSON.stringify(parsed, null, 2))
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)',
          maxHeight: '88vh',
          background: 'var(--surface-1)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Field manager</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
          Whitelisted property keys per label (used for admin PATCH). Edit JSON, then Save.
        </p>
        {loading && !raw ? (
          <p style={{ fontSize: 12 }}>Loading…</p>
        ) : (
          <textarea
            className="input"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            style={{ flex: 1, minHeight: 280, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
        )}
        {err && <p style={{ color: '#f85149', fontSize: 12, margin: 0 }}>{err}</p>}
        <button type="button" className="btn btn-primary" disabled={loading} onClick={save}>Save</button>
      </div>
    </div>
  )
}
