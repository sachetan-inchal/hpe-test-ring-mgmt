import { useState, useEffect } from 'react'
import { Activity, Server, HardDrive, Wifi, AlertTriangle, CheckCircle, XCircle, RefreshCw, Zap } from 'lucide-react'

function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="glass-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1 }}>{value ?? '—'}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: color, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

function ServiceBadge({ name, ok, detail }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {ok ? <CheckCircle size={15} style={{ color: 'var(--status-ok)' }} /> : <XCircle size={15} style={{ color: 'var(--status-critical)' }} />}
        <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
      </div>
      <span style={{ fontSize: 11, color: ok ? 'var(--status-ok)' : 'var(--status-critical)' }}>{detail || (ok ? 'Connected' : 'Unavailable')}</span>
    </div>
  )
}

function IssueRow({ node }) {
  const color = node.status === 'failed' ? 'var(--accent-rose)' : 'var(--accent-amber)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} style={{ color }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{node.name || node.id}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{node.type} {node.parentId ? `· child of ${node.parentId}` : ''}</div>
        </div>
      </div>
      <span className={`badge ${node.status === 'failed' ? 'badge-crit' : 'badge-warn'}`}>{node.status}</span>
    </div>
  )
}

function CapacityBar({ label, used, total, unit = 'TB' }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const color = pct > 90 ? 'var(--accent-rose)' : pct > 75 ? 'var(--accent-amber)' : 'var(--hpe-green)'
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--muted)' }}>{used}{unit} / {total}{unit} <span style={{ color, fontWeight: 600 }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

export default function HealthPage({ apiBase, chatbotApi }) {
  const [health, setHealth] = useState(null)
  const [sanData, setSanData] = useState(null)
  const [topology, setTopology] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchAll = async () => {
    setLoading(true)
    try {
      // API health
      const [hRes, sanRes, topoRes] = await Promise.allSettled([
        fetch(`${apiBase}/api/health`).then(r => r.json()),
        fetch(`${chatbotApi}/health`).then(r => r.json()),
        fetch(`${apiBase}/api/graph/neo4j`).then(r => r.json()),
      ])
      if (hRes.status === 'fulfilled') setHealth(hRes.value)
      if (sanRes.status === 'fulfilled') setSanData(sanRes.value)
      if (topoRes.status === 'fulfilled') {
        const d = topoRes.value
        const nodes = (d.nodes || []).map(n => ({ ...n.data, id: n.data?.id, name: n.data?.name, type: n.data?.label, status: n.data?.status || 'normal', parentId: n.data?.parentId }))
        setTopology({ nodes, edges: d.edges || [] })
      }
    } catch {}
    setLoading(false)
    setLastRefresh(new Date())
  }

  useEffect(() => { fetchAll() }, [])

  // Compute stats from topology
  const activeNodes = topology.nodes.filter(n => !n.isDecommissioned)
  const issues = activeNodes.filter(n => n.status === 'failed' || n.status === 'degraded')
  const arrays = activeNodes.filter(n => n.type === 'ArraySystem' || n.type === 'Array')
  const switches = activeNodes.filter(n => n.type === 'Switch')
  const hosts = activeNodes.filter(n => n.type === 'Host')
  const disks = activeNodes.filter(n => n.type === 'PhysicalDisk' || n.type === 'Disk')

  // Capacity from sanData (chatbot service) or mock from arrays
  const sanNodes = sanData?.nodes || []
  const sanArrays = sanNodes.filter(n => n.type === 'Array')
  const totalCap = sanArrays.reduce((a, n) => a + (n.totalCapacityTb || 0), 0)
  const usedCap = sanArrays.reduce((a, n) => a + (n.usedCapacityTb || 0), 0)

  const services = [
    { name: 'Flask Master API', ok: !!health, detail: health ? `v${health.version || '2.0'} · ${health.neo4j || 'unknown'}` : 'Down' },
    { name: 'Neo4j Graph DB', ok: health?.neo4j === 'connected' || health?.neo4j === 'ok' || health?.neo4j === true, detail: String(health?.neo4j || 'Unknown') },
    { name: 'Elasticsearch', ok: health?.elasticsearch === 'connected' || health?.elasticsearch === 'ok' || health?.elasticsearch === true, detail: String(health?.elasticsearch || 'Unknown') },
    { name: 'Chatbot Service', ok: !!sanData || !!chatbotApi, detail: sanData ? 'Running' : 'Check port 5010' },
    { name: 'Simulator', ok: health?.simulator === 'ok' || health?.simulator === true, detail: String(health?.simulator || 'Unknown') },
  ]

  // Recommendations
  const recommendations = []
  if (issues.length > 0) recommendations.push({ level: 'critical', text: `${issues.filter(n => n.status === 'failed').length} components in FAILED state — immediate attention required` })
  if (issues.filter(n => n.status === 'degraded').length > 0) recommendations.push({ level: 'warn', text: `${issues.filter(n => n.status === 'degraded').length} degraded components — monitor closely` })
  if (totalCap > 0 && usedCap / totalCap > 0.8) recommendations.push({ level: 'warn', text: `Storage utilization above 80% (${Math.round(usedCap / totalCap * 100)}%) — consider expansion` })
  if (recommendations.length === 0) recommendations.push({ level: 'ok', text: 'All systems nominal — no critical issues detected' })

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">System Health</h2>
          <p className="page-subtitle">Last updated: {lastRefresh.toLocaleTimeString()}</p>
        </div>
        <button className="btn" onClick={fetchAll} disabled={loading}><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Nodes" value={activeNodes.length} icon={Activity} color="var(--hpe-green)" sub={`${topology.edges.length} connections`} />
        <StatCard label="Storage Arrays" value={arrays.length} icon={Server} color="var(--accent-blue)" sub={arrays.filter(a => a.status === 'normal').length + ' healthy'} />
        <StatCard label="FC Switches" value={switches.length} icon={Wifi} color="var(--accent-purple)" sub={switches.filter(s => s.status === 'normal').length + ' healthy'} />
        <StatCard label="Hosts" value={hosts.length} icon={Activity} color="var(--accent-cyan)" sub={hosts.filter(h => h.status === 'normal').length + ' healthy'} />
        <StatCard label="Issues" value={issues.length} icon={AlertTriangle} color={issues.length > 0 ? 'var(--accent-rose)' : 'var(--status-ok)'}
          sub={issues.length === 0 ? 'All clear' : `${issues.filter(n => n.status === 'failed').length} failed`} />
        <StatCard label="Physical Disks" value={disks.length} icon={HardDrive} color="var(--accent-amber)" sub={disks.filter(d => d.status === 'normal').length + ' healthy'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Service Status */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Zap size={16} style={{ color: 'var(--hpe-green)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Service Status</span>
          </div>
          {services.map(s => <ServiceBadge key={s.name} {...s} />)}
        </div>

        {/* Capacity */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Storage Capacity</div>
          {totalCap > 0 ? (
            <>
              <CapacityBar label="Total Storage Pool" used={Math.round(usedCap * 10) / 10} total={Math.round(totalCap * 10) / 10} />
              {sanArrays.map(arr => (
                <CapacityBar key={arr.id} label={arr.name} used={Math.round((arr.usedCapacityTb || 0) * 10) / 10} total={Math.round((arr.totalCapacityTb || 0) * 10) / 10} />
              ))}
            </>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>No capacity data available. Ensure the chatbot service is running and SAN data is loaded.</p>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Recommendations */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Recommendations</div>
          {recommendations.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < recommendations.length - 1 ? '1px solid var(--line)' : 'none' }}>
              {r.level === 'critical' ? <XCircle size={16} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} /> :
                r.level === 'warn' ? <AlertTriangle size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} /> :
                  <CheckCircle size={16} style={{ color: 'var(--status-ok)', flexShrink: 0 }} />}
              <span style={{ fontSize: 13, lineHeight: 1.4 }}>{r.text}</span>
            </div>
          ))}
        </div>

        {/* Active Issues */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>
            Active Issues <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 400 }}>({issues.length})</span>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {issues.length === 0
              ? <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>✓ No issues detected</div>
              : issues.map(n => <IssueRow key={n.id} node={n} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
