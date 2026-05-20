// ── Device definitions ────────────────────────────────────────────────────────
const DEVICE_DEFS = {
  'array:alletra-mp':  { label:'Alletra MP',    model:'HPE Alletra Storage MP', icon:'🗄️', badge:'badge-array', defaultProps:{ name:'PROD-A', array_id:'0x1001', ip:'10.20.10.5', node_count:4, drive_count:192, cage_count:8, switch_count:2, host_count:8, subnet:'10.20.10', release_version:'10.6.0.40', protocols:['FC','NVMe','IP'], serial:'HPE00000001', master_node:0 }},
  'array:alletra-9000':{ label:'Alletra 9000',  model:'HPE Alletra 9000',        icon:'🗄️', badge:'badge-array', defaultProps:{ name:'PROD-B', array_id:'0x1002', ip:'10.20.20.5', node_count:2, drive_count:48, cage_count:2, switch_count:2, host_count:4, subnet:'10.20.20', release_version:'10.6.0.40', protocols:['FC','NVMe'], serial:'HPE00000002', master_node:0 }},
  'array:primera':     { label:'Primera 600',   model:'HPE Primera 600',         icon:'🗄️', badge:'badge-array', defaultProps:{ name:'DR-C', array_id:'0x1003', ip:'10.20.30.5', node_count:2, drive_count:48, cage_count:2, switch_count:1, host_count:4, subnet:'10.20.30', release_version:'10.6.0.40', protocols:['FC'], serial:'HPE00000003', master_node:0 }},
  'array:3par':        { label:'3PAR 8450',     model:'HPE 3PAR 8450',           icon:'🗄️', badge:'badge-array', defaultProps:{ name:'ARR-01', array_id:'0x1004', ip:'10.20.40.5', node_count:2, drive_count:24, cage_count:1, switch_count:2, host_count:4, subnet:'10.20.40', release_version:'3.3.1.MU5', protocols:['FC'], serial:'HPE00000004', master_node:0 }},
  'array:nimble':      { label:'Nimble HF60',   model:'HPE Nimble HF60',         icon:'💾', badge:'badge-array', defaultProps:{ name:'EDGE-D', array_id:'0x1005', ip:'10.20.50.5', node_count:2, drive_count:24, cage_count:1, switch_count:1, host_count:4, subnet:'10.20.50', release_version:'6.1.0', protocols:['FC','iSCSI'], serial:'HPE00000005', master_node:0 }},
  'jbof:nvme-jbof':   { label:'NVMe JBOF',     model:'HPE NVMe JBOF',           icon:'📦', badge:'badge-jbof',  defaultProps:{ name:'JBOF-41', cage_id:41, drive_count:24, drive_type:'QLC', capacity_gb:30720, drive_model:'SAMSUNG AELN30T7P5xn' }},
  'jbof:drive-cage':  { label:'Drive Cage',     model:'DCS-4048-G',              icon:'📦', badge:'badge-jbof',  defaultProps:{ name:'cage0', cage_id:0, drive_count:24, drive_type:'NVMe', capacity_gb:3840, drive_model:'KIOXIA KCD6XLUL3T84' }},
  'fc-switch:brocade-g630':  { label:'Brocade G630',   model:'Brocade G630',         icon:'🔀', badge:'badge-fc-sw', defaultProps:{ name:'sw-core-01', ip:'192.168.10.11', domain_id:1, wwn:'10:00:aa:aa:aa:aa:aa:01', fabric:'FABRIC_01', port_count:64, role:'Core', state:'Online' }},
  'fc-switch:brocade-6510':  { label:'Brocade 6510',   model:'Brocade 6510',         icon:'🔀', badge:'badge-fc-sw', defaultProps:{ name:'sw-edge-61', ip:'192.168.10.61', domain_id:61, wwn:'10:00:aa:aa:aa:aa:aa:61', fabric:'FABRIC_01', port_count:48, role:'Edge', state:'Online' }},
  'fc-switch:cisco-mds-9148':{ label:'Cisco MDS 9148S', model:'Cisco MDS 9148S',      icon:'🔀', badge:'badge-fc-sw', defaultProps:{ name:'sw-cisco-01', ip:'192.168.20.1', domain_id:20, wwn:'10:00:cc:cc:cc:cc:cc:01', fabric:'FABRIC_01', port_count:48, role:'Core', state:'Online' }},
  'fc-switch:cisco-mds-9396':{ label:'Cisco MDS 9396T', model:'Cisco MDS 9396T',      icon:'🔀', badge:'badge-fc-sw', defaultProps:{ name:'sw-cisco-02', ip:'192.168.20.2', domain_id:21, wwn:'10:00:cc:cc:cc:cc:cc:02', fabric:'FABRIC_01', port_count:96, role:'Core', state:'Online' }},
  'eth-switch:aruba-cx6300': { label:'Aruba CX 6300',  model:'Aruba CX 6300',        icon:'🌐', badge:'badge-eth-sw',defaultProps:{ name:'eth-sw-01', ip:'10.0.0.1', vlan_iscsi:100, port_count:48, model:'Aruba CX 6300', firmware:'10.09.1020' }},
  'eth-switch:cisco-nexus':  { label:'Cisco Nexus',    model:'Cisco Nexus 9000',     icon:'🌐', badge:'badge-eth-sw',defaultProps:{ name:'eth-sw-02', ip:'10.0.0.2', vlan_iscsi:200, port_count:48, model:'Cisco Nexus 9000', firmware:'15.2' }},
  'host:linux':   { label:'Linux Host',     model:'Red Hat Enterprise Linux 9.2', icon:'🖥️', badge:'badge-host', defaultProps:{ name:'host-lnx-01', ip:'10.50.1.10', os_name:'Red Hat Enterprise Linux', os_version:'9.2', os_type:'linux', wwpn:'1000aaaabbbb0001', hba_model:'Emulex SN1600E', hba_fw:'FV14.0.499.29', hba_driver:'DV14.0.499.31', multipath:'DUAL', iscsi_iqn:'' }},
  'host:vmware':  { label:'VMware ESXi',    model:'VMware ESXi 8.0.3',            icon:'☁️', badge:'badge-host', defaultProps:{ name:'host-esx-01', ip:'10.50.1.20', os_name:'VMware ESXi', os_version:'8.0.3', os_type:'windows', wwpn:'1000aaaabbbb0010', hba_model:'Emulex SN1200E', hba_fw:'FV14.4.473.14', hba_driver:'DV14.4.0.40', multipath:'DUAL', iscsi_iqn:'' }},
  'host:windows': { label:'Windows Server', model:'Windows Server 2022',          icon:'🪟', badge:'badge-host', defaultProps:{ name:'host-win-01', ip:'10.50.1.30', os_name:'Windows Server', os_version:'2022', os_type:'windows', wwpn:'', hba_model:'QLogic QLE2692', hba_fw:'9.08.02', hba_driver:'9.4.1', multipath:'DUAL', iscsi_iqn:'iqn.1991-05.com.microsoft:host-win-01' }},
  'host:oracle':  { label:'Oracle Linux',   model:'Oracle Linux 8.6',             icon:'🖥️', badge:'badge-host', defaultProps:{ name:'host-ora-01', ip:'10.50.1.40', os_name:'Oracle Linux', os_version:'8.6', os_type:'linux', wwpn:'1000aaaabbbb0020', hba_model:'Emulex SN1200E', hba_fw:'FV14.0.499.21', hba_driver:'DV14.0.169.26', multipath:'DUAL', iscsi_iqn:'' }},
};

// ── State ─────────────────────────────────────────────────────────────────────
let devices = [];   // { id, type, subtype, x, y, props }
let connections = []; // { id, from, to, connType }
let selectedId = null;
let connectMode = false;
let connectSource = null;
let dragOffset = { x:0, y:0 };
let draggingId = null;
let nodeCounter = 0;

function uid() { return 'n' + (++nodeCounter); }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const nodesLayer = document.getElementById('nodes-layer');
const edgesSvg   = document.getElementById('edges');
const propsEmpty = document.getElementById('props-empty');
const propsForm  = document.getElementById('props-form');
const dropHint   = document.getElementById('drop-hint');
const connIndicator = document.getElementById('conn-indicator');
const statDevices = document.getElementById('stat-devices');
const statConns   = document.getElementById('stat-conns');
const statMode    = document.getElementById('stat-mode');
const statMsg     = document.getElementById('stat-msg');
const canvasWrap  = document.getElementById('canvas-wrap');

// ── Palette drag ──────────────────────────────────────────────────────────────
document.querySelectorAll('.pal-item[draggable]').forEach(el => {
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('type', el.dataset.type);
    e.dataTransfer.setData('subtype', el.dataset.subtype);
  });
});

canvasWrap.addEventListener('dragover', e => e.preventDefault());
canvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  const type = e.dataTransfer.getData('type');
  const subtype = e.dataTransfer.getData('subtype');
  if (!type) return;
  const rect = canvasWrap.getBoundingClientRect();
  addDevice(type, subtype, e.clientX - rect.left - 60, e.clientY - rect.top - 40);
});

// ── Add device ────────────────────────────────────────────────────────────────
function addDevice(type, subtype, x, y) {
  const key = type + ':' + subtype;
  const def = DEVICE_DEFS[key];
  if (!def) return;
  const id = uid();
  const count = devices.filter(d => d.type===type && d.subtype===subtype).length + 1;
  const props = JSON.parse(JSON.stringify(def.defaultProps));
  // Auto-name to avoid duplicates
  if (props.name && count > 1) {
    const base = props.name.replace(/-\d+$/, '');
    props.name = base + '-' + String(count).padStart(2,'0');
  }
  devices.push({ id, type, subtype, x, y, props });
  renderNode(id);
  updateStats();
  dropHint.style.display = 'none';
  setStatus('Added ' + def.label);
}

// ── Render node ───────────────────────────────────────────────────────────────
function renderNode(id) {
  const d = devices.find(x => x.id === id);
  const key = d.type + ':' + d.subtype;
  const def = DEVICE_DEFS[key];
  let el = document.getElementById('node-' + id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'node-' + id;
    el.className = 'device-node';
    nodesLayer.appendChild(el);
  }
  el.style.left = d.x + 'px';
  el.style.top  = d.y + 'px';
  el.innerHTML = `
    <div class="node-drag-handle"></div>
    <div class="node-icon">${def.icon}</div>
    <div class="node-name">${d.props.name || def.label}</div>
    <div class="node-model">${def.model}</div>
    <div style="text-align:center"><span class="node-badge ${def.badge}">${d.type.toUpperCase()}</span></div>
  `;
  if (selectedId === id) el.classList.add('selected');
  if (connectMode && connectSource === id) el.classList.add('connecting-source');

  // Click: select or connect
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (connectMode) {
      handleConnectClick(id);
    } else {
      selectDevice(id);
    }
  });

  // Drag to move
  const handle = el.querySelector('.node-drag-handle');
  handle.addEventListener('mousedown', e => {
    if (connectMode) return;
    e.preventDefault();
    draggingId = id;
    const rect = el.getBoundingClientRect();
    const wrapRect = canvasWrap.getBoundingClientRect();
    dragOffset.x = e.clientX - (rect.left - wrapRect.left);
    dragOffset.y = e.clientY - (rect.top - wrapRect.top);
  });
}

// Drag move
document.addEventListener('mousemove', e => {
  if (!draggingId) return;
  const wrapRect = canvasWrap.getBoundingClientRect();
  const d = devices.find(x => x.id === draggingId);
  d.x = Math.max(0, e.clientX - wrapRect.left - dragOffset.x);
  d.y = Math.max(0, e.clientY - wrapRect.top - dragOffset.y);
  const el = document.getElementById('node-' + draggingId);
  if (el) { el.style.left = d.x + 'px'; el.style.top = d.y + 'px'; }
  renderEdges();
});
document.addEventListener('mouseup', () => { draggingId = null; });

// Click canvas → deselect
canvasWrap.addEventListener('click', () => {
  if (!connectMode) selectDevice(null);
});

// ── Select ────────────────────────────────────────────────────────────────────
function selectDevice(id) {
  if (selectedId) {
    const prev = document.getElementById('node-' + selectedId);
    if (prev) prev.classList.remove('selected');
  }
  selectedId = id;
  if (id) {
    document.getElementById('node-' + id)?.classList.add('selected');
    showProps(id);
  } else {
    propsEmpty.style.display = '';
    propsForm.style.display = 'none';
  }
}

// ── Properties panel ──────────────────────────────────────────────────────────
const PROP_LABELS = {
  name:'Name', ip:'IP Address', array_id:'Array ID', node_count:'Node Count',
  drive_count:'Drive Count', cage_count:'Cage Count', switch_count:'Switch Count',
  host_count:'Host Count', subnet:'Subnet', release_version:'Release Version',
  serial:'Serial Number', master_node:'Master Node', cage_id:'Cage ID',
  drive_type:'Drive Type', capacity_gb:'Capacity (GB)', drive_model:'Drive Model',
  domain_id:'Domain ID', wwn:'Switch WWN', fabric:'Fabric Name',
  port_count:'Port Count', role:'Role', state:'State', vlan_iscsi:'iSCSI VLAN',
  firmware:'Firmware', os_name:'OS Name', os_version:'OS Version',
  os_type:'OS Type', wwpn:'Host WWPN', hba_model:'HBA Model',
  hba_fw:'HBA Firmware', hba_driver:'HBA Driver', multipath:'Multipath',
  iscsi_iqn:'iSCSI IQN', protocols:'Protocols'
};
const SELECTS = {
  os_type: ['linux','windows'],
  multipath: ['DUAL','SINGLE','NONE'],
  role: ['Core','Edge','Subordinate'],
  state: ['Online','Offline','Degraded'],
  drive_type: ['NVMe','QLC','SSD','HDD'],
  master_node: ['0','1','2','3'],
  node_count: ['2','4','6','8'],
};

function showProps(id) {
  const d = devices.find(x => x.id === id);
  const key = d.type + ':' + d.subtype;
  const def = DEVICE_DEFS[key];
  propsEmpty.style.display = 'none';
  propsForm.style.display = '';
  let html = `<div style="font-size:12px;font-weight:700;color:#58a6ff;margin-bottom:12px">${def.icon} ${def.label}</div>`;
  for (const [k, v] of Object.entries(d.props)) {
    const label = PROP_LABELS[k] || k;
    if (Array.isArray(v)) {
      html += `<div class="prop-group"><label>${label}</label><input id="prop-${k}" value="${v.join(', ')}" /></div>`;
    } else if (SELECTS[k]) {
      const opts = SELECTS[k].map(o => `<option${o===String(v)?' selected':''}>${o}</option>`).join('');
      html += `<div class="prop-group"><label>${label}</label><select id="prop-${k}">${opts}</select></div>`;
    } else {
      html += `<div class="prop-group"><label>${label}</label><input id="prop-${k}" value="${v}" /></div>`;
    }
  }
  propsForm.innerHTML = html;
  propsForm.querySelectorAll('input,select').forEach(inp => {
    inp.addEventListener('change', () => {
      const k = inp.id.replace('prop-','');
      let val = inp.value;
      if (k === 'protocols') val = val.split(',').map(s=>s.trim()).filter(Boolean);
      else if (['node_count','drive_count','cage_count','switch_count','host_count','port_count','domain_id','cage_id','master_node'].includes(k)) val = parseInt(val)||0;
      else if (['capacity_gb'].includes(k)) val = parseFloat(val)||0;
      d.props[k] = val;
      document.querySelector(`#node-${id} .node-name`).textContent = d.props.name || def.label;
    });
  });
}

// ── Connect mode ──────────────────────────────────────────────────────────────
document.getElementById('btn-connect-mode').addEventListener('click', () => {
  connectMode = !connectMode;
  connectSource = null;
  connIndicator.classList.toggle('active', connectMode);
  statMode.innerHTML = 'Mode: <b>' + (connectMode ? 'Connect' : 'Select') + '</b>';
  document.getElementById('btn-connect-mode').textContent = connectMode ? '✖ Exit Connect' : '🔗 Connect Mode';
  if (!connectMode) {
    document.querySelectorAll('.connecting-source').forEach(el => el.classList.remove('connecting-source'));
  }
});

function handleConnectClick(id) {
  if (!connectSource) {
    connectSource = id;
    document.getElementById('node-' + id)?.classList.add('connecting-source');
    setStatus('Now click the target device');
  } else if (connectSource === id) {
    connectSource = null;
    document.querySelectorAll('.connecting-source').forEach(el => el.classList.remove('connecting-source'));
    setStatus('Deselected source');
  } else {
    const type = document.getElementById('conn-type-select').value;
    const existing = connections.find(c => (c.from===connectSource&&c.to===id)||(c.from===id&&c.to===connectSource));
    if (existing) { setStatus('Already connected!'); }
    else {
      connections.push({ id: uid(), from: connectSource, to: id, connType: type });
      renderEdges();
      updateStats();
      setStatus('Connected with ' + type);
    }
    document.getElementById('node-' + connectSource)?.classList.remove('connecting-source');
    connectSource = null;
  }
}

// ── Edges (SVG lines) ─────────────────────────────────────────────────────────
const CONN_COLORS = { FC:'#f85149', iSCSI:'#58a6ff', NVMe:'#bc8cff', ISL:'#ffa657', RCOPY:'#f0e68c', 'NVMe-disk':'#8b949e' };
const CONN_DASH   = { FC:'none', iSCSI:'none', NVMe:'none', ISL:'8,4', RCOPY:'4,4', 'NVMe-disk':'2,4' };

function nodeCenter(id) {
  const d = devices.find(x => x.id === id);
  const el = document.getElementById('node-' + id);
  if (!d || !el) return { x:0, y:0 };
  return { x: d.x + el.offsetWidth/2, y: d.y + el.offsetHeight/2 };
}

function renderEdges() {
  let html = '';
  // Defs for arrowheads
  html += '<defs>';
  for (const [type, color] of Object.entries(CONN_COLORS)) {
    html += `<marker id="arrow-${type}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${color}" opacity="0.8"/></marker>`;
  }
  html += '</defs>';
  for (const c of connections) {
    const a = nodeCenter(c.from), b = nodeCenter(c.to);
    const color = CONN_COLORS[c.connType] || '#8b949e';
    const dash = CONN_DASH[c.connType] || 'none';
    // Midpoint for label
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}" opacity="0.85" marker-end="url(#arrow-${c.connType})" data-conn-id="${c.id}" style="pointer-events:stroke;cursor:pointer"/>`;
    html += `<rect x="${mx-22}" y="${my-9}" width="44" height="16" rx="4" fill="#161b22" opacity="0.85"/>`;
    html += `<text x="${mx}" y="${my+4}" text-anchor="middle" fill="${color}" font-size="9" font-weight="700">${c.connType}</text>`;
  }
  edgesSvg.innerHTML = html;
  // Click on edge to delete
  edgesSvg.querySelectorAll('line[data-conn-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const cid = el.getAttribute('data-conn-id');
      if (confirm('Delete this connection?')) {
        connections = connections.filter(c => c.id !== cid);
        renderEdges();
        updateStats();
      }
    });
  });
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-clear-sel').addEventListener('click', () => selectDevice(null));
document.getElementById('btn-delete').addEventListener('click', () => {
  if (!selectedId) return;
  if (!confirm('Delete selected device?')) return;
  connections = connections.filter(c => c.from !== selectedId && c.to !== selectedId);
  document.getElementById('node-' + selectedId)?.remove();
  devices = devices.filter(d => d.id !== selectedId);
  selectedId = null;
  propsEmpty.style.display = '';
  propsForm.style.display = 'none';
  renderEdges();
  updateStats();
  if (!devices.length) dropHint.style.display = '';
});
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (devices.length && !confirm('Clear entire topology?')) return;
  devices = []; connections = []; selectedId = null;
  nodesLayer.innerHTML = ''; edgesSvg.innerHTML = '';
  propsEmpty.style.display = ''; propsForm.style.display = 'none';
  dropHint.style.display = '';
  updateStats();
});

// ── Stats & status ────────────────────────────────────────────────────────────
function updateStats() {
  statDevices.textContent = devices.length;
  statConns.textContent = connections.length;
}
function setStatus(msg) {
  statMsg.textContent = msg;
  setTimeout(() => { if (statMsg.textContent === msg) statMsg.textContent = ''; }, 3000);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

// ── Export engine ─────────────────────────────────────────────────────────────
function randHex(n){ let s=''; for(let i=0;i<n;i++) s+='0123456789ABCDEF'[Math.floor(Math.random()*16)]; return s; }
function randWWN(){ return [randHex(2),randHex(2),randHex(2),randHex(2),randHex(2),randHex(2),randHex(2),randHex(2)].join(':'); }
function randMAC(){ return [randHex(2),randHex(2),randHex(2),randHex(2),randHex(2),randHex(2)].join(':'); }
function randIP(subnet){ return subnet+'.'+Math.floor(Math.random()*200+10); }
function pad(s,n){ return String(s).padEnd(n); }

function generateArrayDump(d, connectedArrays, connectedSwitches, connectedHosts) {
  const p = d.props;
  const nc = parseInt(p.node_count)||2;
  const dc = parseInt(p.drive_count)||24;
  const cc = parseInt(p.cage_count)||1;
  const model = DEVICE_DEFS[d.type+':'+d.subtype]?.model || 'HPE Array';
  const protocols = Array.isArray(p.protocols) ? p.protocols : ['FC'];
  const lines = [];

  // showversion -b
  lines.push('+ showversion -b');
  lines.push(`Release version ${p.release_version||'10.6.0.40'}`);
  lines.push(`Release Type: Standard Support Release`);
  lines.push('');
  lines.push('Component Name                   Version');
  lines.push(`CLI Server                       ${p.release_version||'10.6.0.40'}`);
  lines.push(`CLI Client                       ${p.release_version||'10.6.0.40'}`);
  lines.push(`System Manager                   ${p.release_version||'10.6.0.40'}`);
  lines.push(`Kernel                           ${p.release_version||'10.6.0.38'}`);
  lines.push(`IO Stack                         ${p.release_version||'10.6.0.40'}`);
  lines.push(`Drive Firmware                   ${p.release_version||'10.6.0.40'}`);
  lines.push(`Enclosure Firmware               ${p.release_version||'10.6.0.40'}`);
  lines.push(`Switch Firmware                  10.15.1010`);
  lines.push(`Upgrade Tool                     643 (250602-10.6.0)`);

  // showsys
  lines.push('+ showsys');
  lines.push('                                                                     ------------------(MiB)------------------');
  lines.push('     ID -Name- ------------Model------------ --Serial-- Nodes Master TotalCap    AllocCap    FreeCap FailedCap');
  const totalCap = dc * 3932160;
  const allocCap = Math.floor(totalCap * 0.6);
  const freeCap  = totalCap - allocCap;
  lines.push(` ${p.array_id||'0x1001'} ${pad(p.name,6)} ${pad(model,30)} ${pad(p.serial||'HPE00000001',10)} ${nc}      ${p.master_node||0} ${pad(totalCap,12)} ${pad(allocCap,12)} ${pad(freeCap,8)} 0`);

  // shownode
  lines.push('+ shownode');
  lines.push('Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------');
  for(let i=0;i<nc;i++){
    const master = i===(parseInt(p.master_node)||0)?'Yes':'No';
    lines.push(`   ${i} ${pad(p.name+'-N'+i,12)} ${Math.floor(i/2)+1}:${(i%2)+1}   ${pad(master,6)} Yes       524288   2026-03-10 01:25:${String(i*3).padStart(2,'0')} PDT`);
  }

  // showswitch (internal fabric switches)
  lines.push('+ showswitch');
  const hasSwitch = connectedSwitches.length > 0;
  if (hasSwitch) {
    lines.push('Name State  Mode   LocateLED Serial     PS1 PS2 Fans Temp');
    connectedSwitches.forEach((sw,i)=>{
      lines.push(`${sw.props.name} ${sw.props.state||'Online'}  Native off       SW${String(i+1).padStart(8,'0')} ok  ok  ok   normal`);
    });
    lines.push(`-----------------------------------------------------------`);
    lines.push(`${connectedSwitches.length}    total`);
  } else {
    lines.push('No switches connected');
  }

  // showport
  lines.push('+ showport');
  lines.push('N:S:P      Mode     State --Node_WWN/IP--- -Port_WWN/HW_Addr- Type Protocol Label');
  const nodeWWN = `2FF70002${randHex(8)}`;
  for(let n=0;n<nc;n++){
    // NVMe disk ports (slots 1-2)
    if(protocols.includes('NVMe')){
      for(let s=1;s<=2;s++){
        for(let pt=1;pt<=2;pt++){
          const ip = `16.${n}.${s}.${90+n}`;
          lines.push(`${n}:${s}:${pt} initiator     ready       ${ip}       ${randHex(12)} disk     NVMe  DP-${pt}`);
        }
      }
    }
    // FC host ports (slot 3)
    if(protocols.includes('FC')){
      lines.push(`${n}:3:1    target     ready ${nodeWWN}   2${String(n+1).padStart(1,'0')}310002AC07F065 host       FC     -`);
      for(let pt=2;pt<=4;pt++){
        lines.push(`${n}:3:${pt}    target loss_sync ${nodeWWN}   2${String(n+1).padStart(1,'0')}3${pt}0002AC07F065 free       FC     -`);
      }
    }
    // IP/iSCSI ports (slot 4)
    if(protocols.includes('IP')||protocols.includes('iSCSI')){
      lines.push(`${n}:4:1    target     ready       20.${n}.16.34       ${randHex(12)} file       IP     -`);
      lines.push(`${n}:4:2    target     ready       20.${n}.26.34       ${randHex(12)} file       IP     -`);
    }
  }
  lines.push(`   ${nc*8}`);

  // showhost
  lines.push('+ showhost');
  lines.push(' Id Name  Persona -WWN/iSCSI_Name/NQN- Port');
  connectedHosts.forEach((h,i)=>{
    const wwpn = h.props.wwpn || randHex(16);
    const iqn  = h.props.iscsi_iqn || '';
    const identifier = iqn || wwpn;
    lines.push(`  ${i} ${pad(h.props.name,16)} Generic-ALUA  ${identifier}     0:3:1`);
    if(h.props.multipath==='DUAL'){
      lines.push(`    ${pad('',16)}               ${identifier}     1:3:1`);
    }
  });
  if(!connectedHosts.length){
    lines.push('--');
    lines.push('0 total');
  }

  // showportdev ns per FC port
  if(protocols.includes('FC') && connectedHosts.length){
    for(let n=0;n<nc;n++){
      lines.push(`+ showportdev ns -nohdtot ${n}:3:1`);
      lines.push(`0xc0200 0x00  0x00 ${nodeWWN} 2031000${n}AC07F065 0x8800 0x0012 n/a    0x0800 2031000${n}AC07F065 ${model} - ${p.serial} - fw:105600                                                              ${n}:3:1`);
      connectedHosts.forEach((h,i)=>{
        const wwpn = h.props.wwpn || randHex(16);
        const nodeWWN2 = '2000' + wwpn.substring(4);
        const hostname = h.props.name;
        const os = h.props.os_name || 'Linux';
        const hba = h.props.hba_model || 'Emulex SN1600E';
        const hbfw = h.props.hba_fw || 'FV14.0.499.29';
        const hbdv = h.props.hba_driver || 'DV14.0.499.31';
        const active = (i%2===0) ? hostname : '-';
        lines.push(`0xc1${String(i+1).padStart(3,'0')} 0x0${i}  0x00 ${nodeWWN2} ${wwpn} 0x0000 0x0000 0x0000 0x0000 2031000${n}AC07F065 ${hba} ${hbfw} ${hbdv} HN:${hostname}.local OS:${os}                             ${active}`);
      });
    }
  }

  // showcage -pci
  lines.push('+ showcage -pci');
  lines.push(' Cage IOM Slot -Type-- Manufacturer --Model--- ----Serial----- -Rev- Firmware');
  for(let n=1;n<=Math.min(nc/2,2);n++){
    lines.push(`    ${n}   1    1 Eth     Mellanox     CX6-DP-DX  MT${randHex(10)}    n/a   22.36.1010`);
    lines.push(`    ${n}   1    2 Eth     Mellanox     CX6-DP-DX  MT${randHex(10)}    n/a   22.36.1010`);
    if(protocols.includes('FC'))
      lines.push(`    ${n}   1    3 FC      HPE          HPE64004-B MY${randHex(10)}      10    14.2.807.6`);
    if(protocols.includes('IP')||protocols.includes('iSCSI'))
      lines.push(`    ${n}   1    4 Eth     Intel        E810-CSFP  ${randHex(12)}    n/a   4.5`);
  }

  // showcage -sfp
  lines.push('+ showcage -sfp');
  lines.push('                                                                                   -(Gbps)-                                               ');
  lines.push(' Cage IOM SFP Label Manufacturer PartNumber       SerialNumber Revision Qualified MaxSpeed TXDisable TXFault RXLoss RXPowerLow DDM -State-');
  for(let cg=41;cg<41+Math.min(cc,4);cg++){
    lines.push(`   ${cg}   1   1 DP-1  FINISAR CORP FCBN425QE2C02-PR ${randHex(10)}   A0       Yes          100.0 No        No      No     No         Yes OK    `);
  }

  // showcage -state
  lines.push('+ showcage -state');
  lines.push('   Id Name   -State- -DetailedState-');
  for(let cg=0;cg<cc;cg++){
    const cageId = cc>4 ? 41+cg : cg;
    lines.push(`    ${cageId} cage${cageId}  Normal  Normal`);
  }
  lines.push(`total                ${cc}`);

  // showpd
  lines.push('+ showpd');
  lines.push('                            ------Size(MiB)------');
  lines.push(' Id CagePos Type RPM State       Total       Free Capacity(GB)');
  const drivesPerCage = Math.ceil(dc/cc);
  let dId=0;
  for(let cg=0;cg<cc;cg++){
    const cageId = cc>4 ? 41+cg : cg;
    for(let s=1;s<=drivesPerCage&&dId<dc;s++,dId++){
      const dtype = protocols.includes('NVMe')?'QLC':'NVMe';
      const cap = dtype==='QLC'?30720:3840;
      const total = dtype==='QLC'?29295616:3932160;
      const free  = total - Math.floor(total*0.06);
      lines.push(` ${String(dId).padStart(3)} ${cageId}:${s}    ${dtype}  N/A normal   ${total}   ${free}        ${cap}`);
    }
  }
  lines.push(`${dc} total`);

  // showpd -s
  lines.push('+ showpd -s');
  lines.push(' Id CagePos Type -State- -Detailed_State- -SedState-');
  dId=0;
  for(let cg=0;cg<cc;cg++){
    const cageId = cc>4 ? 41+cg : cg;
    for(let s=1;s<=drivesPerCage&&dId<dc;s++,dId++){
      const dtype = protocols.includes('NVMe')?'QLC':'NVMe';
      lines.push(` ${String(dId).padStart(3)} ${cageId}:${s}    ${dtype}  normal  normal           capable`);
    }
  }
  lines.push(`${dc} total`);

  // showpd -i
  lines.push('+ showpd -i');
  lines.push(' Id CagePos State  ----Node_WWN---- --MFR-- -----Model------ ----Serial---- -FW_Rev- Protocol Type -----AdmissionTime-----');
  dId=0;
  for(let cg=0;cg<cc;cg++){
    const cageId = cc>4 ? 41+cg : cg;
    for(let s=1;s<=drivesPerCage&&dId<dc;s++,dId++){
      const dtype = protocols.includes('NVMe')?'QLC':'NVMe';
      lines.push(` ${String(dId).padStart(3)} ${cageId}:${s}    normal ${nodeWWN} SAMSUNG AELN30T7P5xnEQRI S7PNNE0X${randHex(6)} 3R01     NVMe     ${dtype}  2026-03-03 23:57:02 PST`);
    }
  }
  lines.push(`${dc} total`);

  // cli checkhealth
  lines.push('+ cli checkhealth');
  lines.push('Checking alert');
  lines.push('Checking cabling');
  lines.push('Checking cage');
  lines.push('Checking cdm');
  lines.push('Checking cert');
  lines.push('Checking dar');
  lines.push('Checking date');
  lines.push('Checking file');
  lines.push('Checking fileservice');
  lines.push('Checking host');
  lines.push('Checking hostkeys');
  lines.push('Checking ilo');
  lines.push('Checking ld');
  lines.push('Checking license');
  lines.push('Checking network');
  lines.push('Checking node');
  lines.push('Checking pd');
  lines.push('Checking pdch');
  lines.push('Checking port');
  lines.push('Checking qos');
  lines.push('Checking rc');
  lines.push('Checking security');
  lines.push('Checking signature');
  lines.push('Checking snmp');
  lines.push('Checking switch');
  lines.push('Checking task');
  lines.push('Checking ui');
  lines.push('Checking vlun');
  lines.push('Checking vv');
  lines.push('Component ----------------Summary Description----------------- Qty');
  lines.push('------------------------------------------------------------------');
  lines.push('        0 total                                                  0');
  lines.push('');

  // lscpu
  lines.push('+ lscpu');
  lines.push('Architecture:        x86_64');
  lines.push('CPU op-mode(s):      32-bit, 64-bit');
  lines.push('Byte Order:          Little Endian');
  lines.push('CPU(s):              48');
  lines.push('Model name:          Intel(R) Xeon(R) Gold 6230R CPU @ 2.10GHz');
  lines.push('CPU MHz:             2100.000');
  lines.push('L1d cache:           32K');
  lines.push('L3 cache:            22528K');

  return lines.join('\n');
}

function generateSwitchDump(sw, fcFabricSwitches) {
  const p = sw.props;
  const lines = [];
  // fabricshow
  lines.push('+ fabricshow');
  lines.push('Switch ID   Worldwide Name          Enet IP Addr    FC IP Addr      Name');
  lines.push('-------------------------------------------------------------------------');
  fcFabricSwitches.forEach((s,i)=>{
    const sp = s.props;
    const domId = sp.domain_id||i+1;
    const wwn = sp.wwn || '10:00:aa:aa:aa:aa:aa:'+String(domId).padStart(2,'0');
    lines.push(`  ${String(domId).padStart(2)}: dmyc${String(domId).toString(16).padStart(2,'0')} ${wwn} ${sp.ip||'192.168.10.'+domId}   0.0.0.0         "${sp.name}"`);
  });
  lines.push(`The Fabric has ${fcFabricSwitches.length} switches`);
  lines.push(`Fabric Name: ${p.fabric||'FABRIC_01'}`);
  // switchshow
  lines.push('+ switchshow');
  lines.push(`switchName:     ${p.name}`);
  lines.push(`switchType:     109.1`);
  lines.push(`switchState:    ${p.state||'Online'}`);
  lines.push(`switchMode:     Native`);
  lines.push(`switchRole:     ${p.role||'Subordinate'}`);
  lines.push(`switchDomain:   ${p.domain_id||1}`);
  lines.push(`switchId:       dmyc${String(p.domain_id||1).toString(16).padStart(2,'0')}`);
  lines.push(`switchWwn:      ${p.wwn||randWWN()}`);
  lines.push(`zoning:         ON (${p.fabric||'FABRIC_01'})`);
  lines.push(`switchBeacon:   OFF`);
  lines.push(`FC Router:      OFF`);
  lines.push(`Fabric Name:    ${p.fabric||'FABRIC_01'}`);
  lines.push(`HIF Mode:       OFF`);
  lines.push(`LS Attributes:  [FID: 128, Base Switch: No, Default Switch: Yes, Address Mode 0]`);
  lines.push('');
  lines.push('Index Port Address  Media Speed   State       Proto');
  lines.push('==================================================');
  const pc = parseInt(p.port_count)||48;
  // First 4 E-Ports (ISL)
  for(let i=0;i<Math.min(4,pc);i++){
    if(i<2){
      lines.push(`   ${i}   ${i}   630${i.toString(16)}00   id    N16     Online      FC  E-Port  ${randWWN()} "sw-peer-${i+1}" (Trunk master)`);
    } else {
      lines.push(`   ${i}   ${i}   630${i.toString(16)}00   id    N16     No_Light    FC`);
    }
  }
  // F-Ports (host/array facing)
  for(let i=4;i<Math.min(20,pc);i++){
    if(i%3!==0){
      lines.push(`  ${String(i).padStart(2)}  ${String(i).padStart(2)}   ${(0x630000+i*0x100).toString(16)}   id    N16     Online      FC  F-Port  ${randWWN()}`);
    } else {
      lines.push(`  ${String(i).padStart(2)}  ${String(i).padStart(2)}   ${(0x630000+i*0x100).toString(16)}   id    N16     No_Light    FC`);
    }
  }
  return lines.join('\n');
}

function generateHostDump(h) {
  const p = h.props;
  const lines = [];
  // systool HBA info (Linux)
  if(p.os_type==='linux'){
    lines.push('+ systool -c fc_host -v | grep -E "Class Device|port_state|port_name|speed"');
    lines.push(`  Class Device = "host5"`);
    lines.push(`    port_name           = "0x${p.wwpn||randHex(16)}"`);
    lines.push(`    port_state          = "Online"`);
    lines.push(`    speed               = "16 Gbit"`);
    lines.push(`    supported_speeds    = "4 Gbit, 8 Gbit, 16 Gbit"`);
    // lspci
    lines.push('+ lspci -nnk | grep -A3 -i "fibre|fc|emulex|qlogic"');
    lines.push(`0a:00.0 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)`);
    lines.push(`        Subsystem: Hewlett Packard Enterprise ${p.hba_model||'StoreFabric SN1200E'} 2-Port 16Gb Fibre Channel Adapter [1590:0214]`);
    lines.push(`        Kernel driver in use: lpfc`);
    lines.push(`        Kernel modules: lpfc`);
  }
  if(p.iscsi_iqn){
    lines.push(`+ iscsiadm -m session`);
    lines.push(`tcp: [1] ${p.ip}:3260,1 ${p.iscsi_iqn} (non-flash)`);
  }
  return lines.join('\n');
}

function generateEthSwitchDump(sw) {
  const p = sw.props;
  const lines = [];
  lines.push(`+ show version`);
  lines.push(`${p.model||'Aruba CX 6300'}`);
  lines.push(`ArubaOS-CX ${p.firmware||'10.09.1020'}`);
  lines.push(`+ show interface brief`);
  lines.push(`Interface     Status  Speed  Description`);
  for(let i=1;i<=8;i++){
    lines.push(`1/${i}           up      25G    port-${i}`);
  }
  lines.push(`+ show vlan brief`);
  lines.push(`VLAN  Name        Status`);
  lines.push(`1     default     active`);
  lines.push(`${p.vlan_iscsi||100}     iSCSI-VLAN  active`);
  return lines.join('\n');
}

function exportTopology() {
  if(!devices.length){ alert('No devices on canvas to export!'); return; }
  const arrays    = devices.filter(d=>d.type==='array');
  const fcSwitches= devices.filter(d=>d.type==='fc-switch');
  const ethSwitches=devices.filter(d=>d.type==='eth-switch');
  const hosts     = devices.filter(d=>d.type==='host');
  const jbofs     = devices.filter(d=>d.type==='jbof');

  const sections = [];
  sections.push(`# HPE SAN Topology — Generated by SAN Editor`);
  sections.push(`# Generated: ${new Date().toISOString()}`);
  sections.push(`# Devices: ${devices.length}  Connections: ${connections.length}`);
  sections.push('');

  // Arrays
  arrays.forEach(arr => {
    const connectedTo = connections.filter(c=>c.from===arr.id||c.to===arr.id);
    const connSwitches = fcSwitches.filter(sw => connectedTo.some(c=>(c.from===sw.id||c.to===sw.id)));
    const connHosts    = hosts.filter(h  => connectedTo.some(c=>(c.from===h.id||c.to===h.id)));
    sections.push(`##############################################`);
    sections.push(`# Array: ${arr.props.name} (${arr.props.ip})`);
    sections.push(`##############################################`);
    sections.push(`ssh root@${arr.props.name}`);
    sections.push(`Warning: the RSA host key for '${arr.props.name}' differs from the key for the IP address '${arr.props.ip}'`);
    sections.push(`Are you sure you want to continue connecting (yes/no)? yes`);
    sections.push(`Password:`);
    sections.push(`root@${arr.props.serial||arr.props.name}-0:~#`);
    sections.push('');
    sections.push(generateArrayDump(arr, arrays.filter(a=>a.id!==arr.id), connSwitches, connHosts));
    sections.push('');
  });

  // FC Switches
  if(fcSwitches.length){
    sections.push(`##############################################`);
    sections.push(`# Fabric / FC Switch Sessions`);
    sections.push(`##############################################`);
    fcSwitches.forEach(sw => {
      sections.push(`ssh admin@${sw.props.name}`);
      sections.push(`admin@${sw.props.name}'s password:`);
      sections.push(`${sw.props.name}:FID100:admin>`);
      sections.push('');
      sections.push(generateSwitchDump(sw, fcSwitches));
      sections.push('');
    });
  }

  // Ethernet switches
  if(ethSwitches.length){
    sections.push(`##############################################`);
    sections.push(`# Ethernet / iSCSI Switch Sessions`);
    sections.push(`##############################################`);
    ethSwitches.forEach(sw => {
      sections.push(`ssh admin@${sw.props.name}`);
      sections.push(`${sw.props.name}#`);
      sections.push('');
      sections.push(generateEthSwitchDump(sw));
      sections.push('');
    });
  }

  // Hosts
  if(hosts.length){
    sections.push(`##############################################`);
    sections.push(`# Host Sessions`);
    sections.push(`##############################################`);
    hosts.forEach(h => {
      sections.push(`ssh root@${h.props.name}`);
      const keyType = h.props.os_type==='linux' ? 'ECDSA' : null;
      if(keyType) {
        sections.push(`Warning: the ${keyType} host key for '${h.props.name}' differs from the key for the IP address '${h.props.ip}'`);
        sections.push(`Are you sure you want to continue connecting (yes/no)? yes`);
      }
      sections.push(`root@${h.props.name}'s password:`);
      sections.push('');
      sections.push(generateHostDump(h));
      sections.push('');
    });
  }

  // Connection summary
  sections.push(`##############################################`);
  sections.push(`# Topology Summary`);
  sections.push(`##############################################`);
  connections.forEach(c=>{
    const src = devices.find(d=>d.id===c.from);
    const tgt = devices.find(d=>d.id===c.to);
    if(src&&tgt) sections.push(`# ${src.props.name} --[${c.connType}]--> ${tgt.props.name}`);
  });

  const blob = new Blob([sections.join('\n')], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'master_unified_scenario.txt';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('✅ Exported master_unified_scenario.txt');
}

document.getElementById('btn-export').addEventListener('click', exportTopology);
