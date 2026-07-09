## FOR SHOWVERSION -B

**CLI O/P:**
```
showversion -b
Release version 10.6.0.40
Release Type: Standard Support Release

Component Name                   Version
CLI Server                       10.6.0.40
CLI Client                       10.6.0.40
System Manager                   10.6.0.40
Kernel                           10.6.0.38
IO Stack                         10.6.0.40
Drive Firmware                   10.6.0.40
Enclosure Firmware               10.6.0.40
Switch Firmware                  10.15.1010
Upgrade Tool                     643 (250602-10.6.0)
```

**PARSING FUNCTION:**
```javascript
function parseShowVersion(cliOutput) {
    const result = {
        release_version: null,
        release_type: null,
        components: []
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) continue;

        // Release version
        let match = line.match(/^Release version\s+(.+)$/);
        if (match) {
            result.release_version = match[1].trim();
            continue;
        }

        // Release type
        match = line.match(/^Release Type:\s*(.+)$/);
        if (match) {
            result.release_type = match[1].trim();
            continue;
        }

        // Table starts
        if (/^Component Name\s+Version$/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Parse from the right.
        //
        // Everything before the version = component name.
        //
        // Handles:
        // Upgrade Tool   643 (250602-10.6.0)
        // CLI Server     10.6.0.40
        // Kernel         10.6.0.38

        match = line.match(/^(.+?)\s{2,}(.+)$/);

        if (!match)
            continue;

        result.components.push({
            name: match[1].trim(),
            version: match[2].trim()
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- components[].name
- components[].version
- release_type
- release_version

**PARSED OUTPUT:**
```json
{
  "release_version": "10.6.0.40",
  "release_type": "Standard Support Release",
  "components": [
    {
      "name": "CLI Server",
      "version": "10.6.0.40"
    },
    {
      "name": "CLI Client",
      "version": "10.6.0.40"
    },
    {
      "name": "System Manager",
      "version": "10.6.0.40"
    },
    {
      "name": "Kernel",
      "version": "10.6.0.38"
    },
    {
      "name": "IO Stack",
      "version": "10.6.0.40"
    },
    {
      "name": "Drive Firmware",
      "version": "10.6.0.40"
    },
    {
      "name": "Enclosure Firmware",
      "version": "10.6.0.40"
    },
    {
      "name": "Switch Firmware",
      "version": "10.15.1010"
    },
    {
      "name": "Upgrade Tool",
      "version": "643 (250602-10.6.0)"
    }
  ]
}
```

## FOR SHOWSYS

**CLI O/P:**
```
showsys
ID -Name- --------Model--------- --Serial-- Nodes Master TotalCap   AllocCap   FreeCap FailedCap
0xD0001 s9999  HPE Alletra Storage MP DUMMY000999     2      0 703070208 536439706 118486118         0
```

**PARSING FUNCTION:**
```javascript
function parseShowSys(cliOutput) {
    const result = {
        id: null,
        name: null,
        model: null,
        serial: null,
        nodes: null,
        master: null,
        total_cap: null,
        alloc_cap: null,
        free_cap: null,
        failed_cap: null
    };

    // Find the data line
    const lines = cliOutput.split(/\r?\n/);

    let dataLine = null;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) continue;
        if (/^ID\b/.test(trimmed)) continue;
        if (/^-+/.test(trimmed)) continue;
        if (trimmed.includes("(MiB)")) continue;

        if (/^0x[0-9A-Fa-f]+\s+/.test(trimmed)) {
            dataLine = trimmed;
            break;
        }
    }

    if (!dataLine) return result;

    const parts = dataLine.split(/\s+/);

    // Need:
    // id name model... serial nodes master total alloc free failed
    if (parts.length < 9) return result;

    // Parse fixed fields from the right
    result.failed_cap = Number(parts.pop());
    result.free_cap   = Number(parts.pop());
    result.alloc_cap  = Number(parts.pop());
    result.total_cap  = Number(parts.pop());
    result.master     = Number(parts.pop());
    result.nodes      = Number(parts.pop());

    result.serial = parts.pop();

    result.id = parts.shift();
    result.name = parts.shift();

    result.model = parts.join(" ");

    return result;
}
```

**EXTRACTED PARAMETERS:**
- alloc_cap
- failed_cap
- free_cap
- id
- master
- model
- name
- nodes
- serial
- total_cap

**PARSED OUTPUT:**
```json
{
  "id": "0xD0001",
  "name": "s9999",
  "model": "HPE Alletra Storage MP",
  "serial": "DUMMY000999",
  "nodes": 2,
  "master": 0,
  "total_cap": 703070208,
  "alloc_cap": 536439706,
  "free_cap": 118486118,
  "failed_cap": 0
}
```

## FOR SHOWNODE

**CLI O/P:**
```
shownode
Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------
   0 4UW0004634-0      1:1 Yes    Yes         515539 2026-03-10 01:25:24 PDT
   1 4UW0004634-1      1:2 No     Yes         515539 2026-03-10 01:25:27 PDT
   2 4UW0004634-2      2:1 No     Yes         515539 2026-03-10 01:25:29 PDT
   3 4UW0004634-3      2:2 No     Yes         515539 2026-03-10 01:25:00 PDT
```

**PARSING FUNCTION:**
```javascript
function parseShowNode(cliOutput) {
    const result = {
        nodes: []
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Detect table header
        if (/^Node\b.*\bName\b.*\bEncl:Bay\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Ignore separator lines
        if (/^-+$/.test(line))
            continue;

        const parts = line.split(/\s+/);

        // Need at least:
        // Node Name Encl:Bay Master InCluster Mem Date Time TZ
        if (parts.length < 9)
            continue;

        const nodeId = Number(parts.shift());

        if (Number.isNaN(nodeId))
            continue;

        const name = parts.shift();
        const enclBay = parts.shift();

        const master = parts.shift();
        const inCluster = parts.shift();

        const mem = Number(parts.shift());

        if (Number.isNaN(mem))
            continue;

        // Whatever remains belongs to Up_Since.
        const upSince = parts.join(" ");

        result.nodes.push({
            node_id: nodeId,
            name,
            encl_bay: enclBay,
            is_master: /^yes$/i.test(master),
            in_cluster: /^yes$/i.test(inCluster),
            mem_mib: mem,
            up_since: upSince
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- nodes[].encl_bay
- nodes[].in_cluster
- nodes[].is_master
- nodes[].mem_mib
- nodes[].name
- nodes[].node_id
- nodes[].up_since

**PARSED OUTPUT:**
```json
{
  "nodes": [
    {
      "node_id": 0,
      "name": "4UW0004634-0",
      "encl_bay": "1:1",
      "is_master": true,
      "in_cluster": true,
      "mem_mib": 515539,
      "up_since": "2026-03-10 01:25:24 PDT"
    },
    {
      "node_id": 1,
      "name": "4UW0004634-1",
      "encl_bay": "1:2",
      "is_master": false,
      "in_cluster": true,
      "mem_mib": 515539,
      "up_since": "2026-03-10 01:25:27 PDT"
    },
    {
      "node_id": 2,
      "name": "4UW0004634-2",
      "encl_bay": "2:1",
      "is_master": false,
      "in_cluster": true,
      "mem_mib": 515539,
      "up_since": "2026-03-10 01:25:29 PDT"
    },
    {
      "node_id": 3,
      "name": "4UW0004634-3",
      "encl_bay": "2:2",
      "is_master": false,
      "in_cluster": true,
      "mem_mib": 515539,
      "up_since": "2026-03-10 01:25:00 PDT"
    }
  ]
}
```

## FOR SHOWPORT (Token-Based with N:S:P Decomposition)

**CLI O/P:**
```
showport
N:S:P      Mode     State --Node_WWN/IP--- -Port_WWN/HW_Addr-    Type Protocol Label
0:2:1 initiator     ready         10.10.8.1       AA88CC44D5E0    disk     NVMe  DP-1
0:2:2 initiator loss_sync         10.10.9.1       AA88CC44D5E1    free     NVMe  DP-2
0:3:1    target     ready 2FF70000DUMMY001   20310000DUMMY001    host       FC     -
0:3:2    target     ready 2FF70000DUMMY001   20320000DUMMY001    free       FC     -
0:3:3    target     ready 2FF70000DUMMY001   20330000DUMMY001    free       FC     -
0:3:4    target loss_sync 2FF70000DUMMY001   20340000DUMMY001    free       FC     -
0:4:1    target   offline          0.0.0.0       40A6B70073B8    free    iSCSI     -
0:4:2    target   offline          0.0.0.0       40A6B70073B9    free    iSCSI     -
0:4:3      peer   offline                -       40A6B70073BA    free       IP     -
0:4:4      peer   offline                -       40A6B70073BB    free       IP     -
0:5:1      peer     ready                -        202AC000100 cluster       IP     -
0:5:2      peer     ready                -        202AC000100 cluster       IP     -
1:2:1 initiator     ready         10.10.8.2       AA88CC44D490    disk     NVMe  DP-1
1:2:2 initiator loss_sync         10.10.9.2       AA88CC44D491    free     NVMe  DP-2
1:3:1    target     ready 2FF70000DUMMY001   21310000DUMMY001    host       FC     -
1:3:2    target     ready 2FF70000DUMMY001   21320000DUMMY001    free       FC     -
1:3:3    target     ready 2FF70000DUMMY001   21330000DUMMY001    free       FC     -
1:3:4    target loss_sync 2FF70000DUMMY001   21340000DUMMY001    free       FC     -
1:4:1    target   offline          0.0.0.0       40A6B7006D68    free    iSCSI     -
1:4:2    target   offline          0.0.0.0       40A6B7006D69    free    iSCSI     -
1:4:3      peer   offline                -       40A6B7006D6A    free       IP     -
1:4:4      peer   offline                -       40A6B7006D6B    free       IP     -
1:5:1      peer     ready                -        202AC000101 cluster       IP     -
1:5:2      peer     ready                -        202AC000101 cluster       IP     -
------------------------------------------------------------------------------------
   24
```

**PARSING FUNCTION:**
```javascript
function parseShowPort(cliOutput) {
    const result = {
        ports: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Detect header
        if (/^N:S:P\b.*\bMode\b.*\bState\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Ignore separator lines
        if (/^-+$/.test(line))
            continue;

        // Total count (appears after the separator)
        if (/^\d+$/.test(line)) {
            result.total = Number(line);
            break;
        }

        const parts = line.split(/\s+/);

        // Expected:
        // NSP Mode State NodeWWN/IP PortWWN/HW Type Protocol Label
        if (parts.length < 8)
            continue;

        const port = {};

        // Consume from left
        port.nsp = parts.shift();

        const [node, slot, portNum] = port.nsp.split(":").map(Number);

        port.node = Number.isNaN(node) ? null : node;
        port.slot = Number.isNaN(slot) ? null : slot;
        port.port = Number.isNaN(portNum) ? null : portNum;

        port.mode = parts.shift();
        port.state = parts.shift();

        // Consume from right
        port.label = parts.pop();
        port.protocol = parts.pop();
        port.type = parts.pop();
        port.port_wwn_hw = parts.pop();

        // Whatever remains is Node_WWN/IP
        port.node_wwn_ip = parts.join(" ");

        result.ports.push(port);
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- ports[].label
- ports[].mode
- ports[].node
- ports[].node_wwn_ip
- ports[].nsp
- ports[].port
- ports[].port_wwn_hw
- ports[].protocol
- ports[].slot
- ports[].state
- ports[].type
- total

**PARSED OUTPUT:**
```json
{
  "ports": [
    {
      "nsp": "0:2:1",
      "node": 0,
      "slot": 2,
      "port": 1,
      "mode": "initiator",
      "state": "ready",
      "node_wwn_ip": "10.10.8.1",
      "port_wwn_hw": "AA88CC44D5E0",
      "type": "disk",
      "protocol": "NVMe",
      "label": "DP-1"
    },
    {
      "nsp": "0:2:2",
      "node": 0,
      "slot": 2,
      "port": 2,
      "mode": "initiator",
      "state": "loss_sync",
      "node_wwn_ip": "10.10.9.1",
      "port_wwn_hw": "AA88CC44D5E1",
      "type": "free",
      "protocol": "NVMe",
      "label": "DP-2"
    },
    {
      "nsp": "0:3:1",
      "node": 0,
      "slot": 3,
      "port": 1,
      "mode": "target",
      "state": "ready",
      "node_wwn_ip": "2FF70000DUMMY001",
      "port_wwn_hw": "20310000DUMMY001",
      "type": "host",
      "protocol": "FC",
      "label": "-"
    }
  ],
  "total": 24
}
```

## FOR SHOWSWITCH

**CLI O/P:**
```
showswitch
No switches listed
```

**PARSING FUNCTION:**
```javascript
function parseShowSwitch(cliOutput) {
    const result = {
        switches: [],
        total: null,
        message: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // "No switches listed"
        if (/^No switches listed$/i.test(line)) {
            result.message = "No switches listed";
            return result;
        }

        // Header
        if (/^Name\b.*\bState\b.*\bMode\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(\d+)\s+total$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1]);
            break;
        }

        const parts = line.split(/\s+/);

        // Expected:
        // Name State Mode LocateLED Serial PS1 PS2 Fans Temp
        if (parts.length < 9)
            continue;

        result.switches.push({
            name: parts.shift(),
            state: parts.shift(),
            mode: parts.shift(),
            locate_led: parts.shift(),
            serial: parts.shift(),
            ps1: parts.shift(),
            ps2: parts.shift(),
            fans: parts.shift(),
            temp: parts.join(" ") // preserves any future multi-word temperature/status
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- message
- switches[].fans
- switches[].locate_led
- switches[].mode
- switches[].name
- switches[].ps1
- switches[].ps2
- switches[].serial
- switches[].state
- switches[].temp
- total

**PARSED OUTPUT:**
```json
{
  "switches": [],
  "total": null,
  "message": "No switches listed"
}
```

## FOR SHOWHOST

**CLI O/P:**
```
showhost
Id Name            Persona      -WWN/iSCSI_Name/NQN- Port
                                1000AAAABBBB1001     0:3:1
                                1000AAAABBBB1002     1:3:1
                                1000AAAABBBB1003     1:3:1
                                1000AAAABBBB1003     0:3:1
...
----------------------------------------------------------
22 total
```

**PARSING FUNCTION:**
```javascript
function parseShowHost(cliOutput) {
    const result = {
        hosts: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;
    let currentHost = null;
    const standaloneHosts = new Map();

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (!line.trim())
            continue;

        // Header
        if (/-WWN\/iSCSI_Name\/NQN-/.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line.trim()))
            continue;

        // Footer
        const totalMatch = line.match(/^(\d+)\s+total$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1]);
            break;
        }

        const parts = line.trim().split(/\s+/);

        if (parts.length < 2)
            continue;

        //------------------------------------------------------------------
        // Find WWN
        //------------------------------------------------------------------

        const wwnIndex = parts.findIndex(p =>
            /^[A-Fa-f0-9]{12,32}$/.test(p)
        );

        if (wwnIndex === -1)
            continue;

        const wwn = parts[wwnIndex];

        //------------------------------------------------------------------
        // Port
        //------------------------------------------------------------------

        let portObj = null;

        const nsp = parts.find(p => /^\d+:\d+:\d+$/.test(p));

        if (nsp) {
            const [node, slot, port] = nsp.split(":").map(Number);

            portObj = {
                nsp,
                node,
                slot,
                port
            };
        }

        //------------------------------------------------------------------
        // Prefix before WWN
        //------------------------------------------------------------------

        const prefix = parts.slice(0, wwnIndex);

        //------------------------------------------------------------------
        // New host?
        //------------------------------------------------------------------

        if (prefix.length >= 3 && /^\d+$/.test(prefix[0])) {

            const host = {
                host_id: Number(prefix[0]),
                name: prefix[1] || null,
                persona: prefix.slice(2).join(" ") || null,
                wwn,
                wwns: [wwn],
                Port: []
            };

            if (portObj)
                host.Port.push(portObj);

            result.hosts.push(host);
            currentHost = host;
            continue;
        }

        //------------------------------------------------------------------
        // Continuation line?
        //------------------------------------------------------------------

        if (currentHost) {

            if (!currentHost.wwns.includes(wwn))
                currentHost.wwns.push(wwn);

            if (portObj &&
                !currentHost.Port.some(p => p.nsp === portObj.nsp)) {
                currentHost.Port.push(portObj);
            }

            continue;
        }

        //------------------------------------------------------------------
        // Standalone WWN
        //------------------------------------------------------------------

        if (!standaloneHosts.has(wwn)) {

            standaloneHosts.set(wwn, {
                wwn,
                Port: []
            });
        }

        if (portObj) {

            const host = standaloneHosts.get(wwn);

            if (!host.Port.some(p => p.nsp === portObj.nsp))
                host.Port.push(portObj);
        }
    }

    // Add WWN-only hosts
    result.hosts.push(...standaloneHosts.values());

    return result;
}
```

**EXTRACTED PARAMETERS:**
- hosts[].Port
- hosts[].Port[].node
- hosts[].Port[].nsp
- hosts[].Port[].port
- hosts[].Port[].slot
- hosts[].wwn
- total

**PARSED OUTPUT:**
```json
{
  "hosts": [
    {
      "wwn": "1000AAAABBBB1001",
      "Port": [
        { "nsp": "0:3:1", "node": 0, "slot": 3, "port": 1 }
      ]
    },
    {
      "wwn": "1000AAAABBBB1002",
      "Port": [
        { "nsp": "1:3:1", "node": 1, "slot": 3, "port": 1 }
      ]
    },
    {
      "wwn": "1000AAAABBBB1003",
      "Port": [
        { "nsp": "1:3:1", "node": 1, "slot": 3, "port": 1 },
        { "nsp": "0:3:1", "node": 0, "slot": 3, "port": 1 }
      ]
    },
    {
      "wwn": "1000AAAABBBB1004",
      "Port": []
    }
  ],
  "total": 22
}
```

## FOR SHOWCAGE (Basic)

**CLI O/P:**
```
showcage
Id Name   Drives Temp  Model FormFactor State
 1 cage1      24 32-35 DCN7  SFF        normal
41 cage41     24 35-38 DCF2  SFF        normal
```

**PARSING FUNCTION:**
```javascript
function parseShowCageBasic(cliOutput) {
    const result = {
        cages: []
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Id\b.*\bName\b.*\bDrives\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        const parts = line.split(/\s+/);

        // Need at least:
        // Id Name Drives Temp Model FormFactor State
        if (parts.length < 7)
            continue;

        const state = parts.pop();
        const formFactor = parts.pop();

        const id = Number(parts.shift());
        const name = parts.shift();
        const drives = Number(parts.shift());
        const temp = parts.shift();

        const model = parts.join(" ");

        if (Number.isNaN(id) || Number.isNaN(drives))
            continue;

        result.cages.push({
            id,
            name,
            drives,
            temp,
            model,
            form_factor: formFactor,
            state
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- cages[].drives
- cages[].form_factor
- cages[].id
- cages[].model
- cages[].name
- cages[].state
- cages[].temp

**PARSED OUTPUT:**
```json
{
  "cages": [
    {
      "id": 1,
      "name": "cage1",
      "drives": 24,
      "temp": "32-35",
      "model": "DCN7",
      "form_factor": "SFF",
      "state": "normal"
    },
    {
      "id": 41,
      "name": "cage41",
      "drives": 24,
      "temp": "35-38",
      "model": "DCF2",
      "form_factor": "SFF",
      "state": "normal"
    }
  ]
}
```

## FOR SHOWCAGE -STATE

**CLI O/P:**
```
showcage -state
   Id Name   -State- -DetailedState-
    1 cage1  Normal  Normal
    2 cage2  Normal  Normal
   41 cage41 Normal  Normal
   42 cage42 Normal  Normal
   43 cage43 Normal  Normal
   44 cage44 Normal  Normal
   45 cage45 Normal  Normal
   46 cage46 Normal  Normal
   47 cage47 Normal  Normal
   48 cage48 Normal  Normal
   49 cage49 Normal  Normal
   50 cage50 Normal  Normal
------------------------------------
total                12
```

**PARSING FUNCTION:**
```javascript
function parseShowCageState(cliOutput) {
    const result = {
        cages: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Id\b.*\bName\b.*\bState\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(?:total\s+(\d+)|(\d+)\s+total)$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1] || totalMatch[2]);
            break;
        }

        const parts = line.split(/\s+/);

        // Minimum:
        // Id Name State DetailedState
        if (parts.length < 4)
            continue;

        const id = Number(parts.shift());

        if (Number.isNaN(id))
            continue;

        const name = parts.shift();
        const state = parts.shift();

        // Everything remaining belongs to DetailedState
        const detailedState = parts.join(" ");

        result.cages.push({
            id,
            name,
            state,
            detailed_state: detailedState
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- cages[].detailed_state
- cages[].id
- cages[].name
- cages[].state
- total

**PARSED OUTPUT:**
```json
{
  "cages": [
    { "id": 1, "name": "cage1", "state": "Normal", "detailed_state": "Normal" },
    { "id": 2, "name": "cage2", "state": "Normal", "detailed_state": "Normal" },
    { "id": 41, "name": "cage41", "state": "Normal", "detailed_state": "Normal" },
    { "id": 42, "name": "cage42", "state": "Normal", "detailed_state": "Normal" },
    { "id": 43, "name": "cage43", "state": "Normal", "detailed_state": "Normal" },
    { "id": 44, "name": "cage44", "state": "Normal", "detailed_state": "Normal" },
    { "id": 45, "name": "cage45", "state": "Normal", "detailed_state": "Normal" },
    { "id": 46, "name": "cage46", "state": "Normal", "detailed_state": "Normal" },
    { "id": 47, "name": "cage47", "state": "Normal", "detailed_state": "Normal" },
    { "id": 48, "name": "cage48", "state": "Normal", "detailed_state": "Normal" },
    { "id": 49, "name": "cage49", "state": "Normal", "detailed_state": "Normal" },
    { "id": 50, "name": "cage50", "state": "Normal", "detailed_state": "Normal" }
  ],
  "total": 12
}
```

## FOR SHOWCAGE -PCI

**CLI O/P:**
```
showcage -pci
 Cage IOM Slot -Type-- Manufacturer --Model--- ----Serial----- -Rev- Firmware
    1   1    1 Eth     Mellanox     CX6-DP-DX  MT2324T00530    n/a   22.36.1010
    1   1    2 Eth     Mellanox     CX6-DP-DX  MT2324T0053J    n/a   22.36.1010
    ... (truncated)
-------------------------------------------------------------------------------
total                                                                36
```

**PARSING FUNCTION:**
```javascript
function parseShowCagePCI(cliOutput) {
    const result = {
        slots: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Cage\b.*\bIOM\b.*\bSlot\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(?:total\s+(\d+)|(\d+)\s+total)$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1] || totalMatch[2]);
            break;
        }

        const parts = line.split(/\s+/);

        if (parts.length < 9)
            continue;

        const firmware = parts.pop();
        const rev = parts.pop();

        const cage = Number(parts.shift());
        const iom = Number(parts.shift());
        const slot = Number(parts.shift());
        const type = parts.shift();

        if ([cage, iom, slot].some(Number.isNaN))
            continue;

        const middle = [...parts];

        let manufacturer = "";
        let model = "";
        let serial = "";

        // Current firmware appears to use:
        // Manufacturer Model Serial
        if (middle.length >= 3) {
            manufacturer = middle.shift();
            serial = middle.pop();
            model = middle.join(" ");
        }
        else if (middle.length === 2) {
            manufacturer = middle[0];
            serial = middle[1];
        }
        else if (middle.length === 1) {
            manufacturer = middle[0];
        }

        result.slots.push({
            cage,
            iom,
            slot,
            type,
            manufacturer,
            model,
            serial,
            rev,
            firmware
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- slots[].cage
- slots[].firmware
- slots[].iom
- slots[].manufacturer
- slots[].model
- slots[].rev
- slots[].serial
- slots[].slot
- slots[].type
- total

**PARSED OUTPUT:**
```json
{
  "slots": [
    {
      "cage": 1,
      "iom": 1,
      "slot": 1,
      "type": "Eth",
      "manufacturer": "Mellanox",
      "model": "CX6-DP-DX",
      "serial": "MT2324T00530",
      "rev": "n/a",
      "firmware": "22.36.1010"
    },
    {
      "cage": 1,
      "iom": 1,
      "slot": 2,
      "type": "Eth",
      "manufacturer": "Mellanox",
      "model": "CX6-DP-DX",
      "serial": "MT2324T0053J",
      "rev": "n/a",
      "firmware": "22.36.1010"
    }
  ],
  "total": 36
}
```

## FOR SHOWCAGE -SFP

**CLI O/P:**
```
showcage -sfp
                                                                                  -(Gbps)-                                               
 Cage IOM SFP Label Manufacturer PartNumber       SerialNumber Revision Qualified MaxSpeed TXDisable TXFault RXLoss RXPowerLow DDM -State-
   41   1   1 DP-1  FINISAR CORP FCBN425QE2C02-PR CN27L1317D   A0       Yes          100.0 No        No      No     No         Yes OK
   41   2   1 DP-1  FINISAR CORP FCBN425QE2C02-PR CN27L1311T   A0       Yes          100.0 No        No      No     No         Yes OK
    ... (truncated)
------------------------------------------------------------------------------------------------------------------------------------------
total                                                                                                                              20
```

**PARSING FUNCTION:**
```javascript
function parseShowCageSFP(cliOutput) {
    const result = {
        sfps: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Cage\b.*\bIOM\b.*\bSFP\b.*\bState\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(?:total\s+(\d+)|(\d+)\s+total)$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1] || totalMatch[2]);
            break;
        }

        const parts = line.split(/\s+/);

        if (parts.length < 15)
            continue;

        // ---------- Consume from right ----------

        const state = parts.pop();
        const ddm = parts.pop();
        const rxPowerLow = parts.pop();
        const rxLoss = parts.pop();
        const txFault = parts.pop();
        const txDisable = parts.pop();
        const maxSpeedGbps = Number(parts.pop());
        const qualified = parts.pop();
        const revision = parts.pop();
        const serialNumber = parts.pop();
        const partNumber = parts.pop();

        // ---------- Consume from left ----------

        const cage = Number(parts.shift());
        const iom = Number(parts.shift());
        const sfp = Number(parts.shift());
        const label = parts.shift();

        if ([cage, iom, sfp].some(Number.isNaN))
            continue;

        // Everything remaining is Manufacturer
        const manufacturer = parts.join(" ");

        result.sfps.push({
            cage,
            iom,
            sfp,
            label,
            manufacturer,
            part_number: partNumber,
            serial_number: serialNumber,
            revision,
            qualified,
            max_speed_gbps: maxSpeedGbps,
            tx_disable: txDisable,
            tx_fault: txFault,
            rx_loss: rxLoss,
            rx_power_low: rxPowerLow,
            ddm,
            state
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- sfps[].cage
- sfps[].ddm
- sfps[].iom
- sfps[].label
- sfps[].manufacturer
- sfps[].max_speed_gbps
- sfps[].part_number
- sfps[].qualified
- sfps[].revision
- sfps[].rx_loss
- sfps[].rx_power_low
- sfps[].serial_number
- sfps[].sfp
- sfps[].state
- sfps[].tx_disable
- sfps[].tx_fault
- total

**PARSED OUTPUT:**
```json
{
  "sfps": [
    {
      "cage": 41,
      "iom": 1,
      "sfp": 1,
      "label": "DP-1",
      "manufacturer": "FINISAR CORP",
      "part_number": "FCBN425QE2C02-PR",
      "serial_number": "CN27L1317D",
      "revision": "A0",
      "qualified": "Yes",
      "max_speed_gbps": 100.0,
      "tx_disable": "No",
      "tx_fault": "No",
      "rx_loss": "No",
      "rx_power_low": "No",
      "ddm": "Yes",
      "state": "OK"
    }
  ],
  "total": 20
}
```

## FOR SHOWPD (Basic – Capacity Table)

**CLI O/P:**
```
showpd
                           ----Size(MiB)-----
Id CagePos Type RPM State      Total     Free Capacity(GB)
 0 1:1     SSD  N/A normal  14647296  1122304        15360
 1 1:2     SSD  N/A normal  14647296  1122304        15360
...
----------------------------------------------------------
48 total                   703070208 56586240
```

**PARSING FUNCTION:**
```javascript
function parseShowPdBasic(cliOutput) {
    const result = {
        drives: [],
        total: null,
        total_cap: null,
        free_cap: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Id\b.*\bCagePos\b.*\bType\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(\d+)\s+total\s+(\d+)\s+(\d+)$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1]);
            result.total_cap = Number(totalMatch[2]);
            result.free_cap = Number(totalMatch[3]);
            break;
        }

        const parts = line.split(/\s+/);

        if (parts.length !== 8)
            continue;

        const id = Number(parts.shift());
        const cagePos = parts.shift();
        const type = parts.shift();

        const rpmToken = parts.shift();
        const rpm = rpmToken === "N/A" ? null : Number(rpmToken);

        const state = parts.shift();
        const totalMiB = Number(parts.shift());
        const freeMiB = Number(parts.shift());
        const capacityGB = Number(parts.shift());

        if (
            Number.isNaN(id) ||
            Number.isNaN(totalMiB) ||
            Number.isNaN(freeMiB) ||
            Number.isNaN(capacityGB) ||
            (rpm !== null && Number.isNaN(rpm))
        ) {
            continue;
        }

        result.drives.push({
            id,
            cage_pos: cagePos,
            type,
            rpm,
            state,
            total_mib: totalMiB,
            free_mib: freeMiB,
            capacity_gb: capacityGB
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- drives[].cage_pos
- drives[].capacity_gb
- drives[].free_mib
- drives[].id
- drives[].rpm
- drives[].state
- drives[].total_mib
- drives[].type
- free_cap
- total
- total_cap

**PARSED OUTPUT:**
```json
{
  "drives": [
    {
      "id": 0,
      "cage_pos": "1:1",
      "type": "SSD",
      "rpm": null,
      "state": "normal",
      "total_mib": 14647296,
      "free_mib": 1122304,
      "capacity_gb": 15360
    },
    {
      "id": 1,
      "cage_pos": "1:2",
      "type": "SSD",
      "rpm": null,
      "state": "normal",
      "total_mib": 14647296,
      "free_mib": 1122304,
      "capacity_gb": 15360
    }
  ],
  "total": 48,
  "total_cap": 703070208,
  "free_cap": 56586240
}
```

## FOR SHOWPD -S (Drive State & SED)

**CLI O/P:**
```
showpd -s
Id CagePos Type -State- -Detailed_State- --SedState--
 0 1:1     SSD  normal  normal           not_capable
 1 1:2     SSD  normal  normal           not_capable
...
-----------------------------------------------------
48 total
```

**PARSING FUNCTION:**
```javascript
function parseShowPdS(cliOutput) {
    const result = {
        drives: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Id\b.*\bCagePos\b.*\bType\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(\d+)\s+total$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1]);
            break;
        }

        const parts = line.split(/\s+/);

        if (parts.length < 6)
            continue;

        const id = Number(parts.shift());
        const cagePos = parts.shift();
        const type = parts.shift();

        if (Number.isNaN(id))
            continue;

        // Consume fixed rightmost field
        const sedState = parts.pop();

        // Consume fixed left field
        const state = parts.shift();

        // Whatever remains belongs to Detailed_State
        const detailedState = parts.join(" ");

        result.drives.push({
            id,
            cage_pos: cagePos,
            type,
            state,
            detailed_state: detailedState,
            sed_state: sedState
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- drives[].cage_pos
- drives[].detailed_state
- drives[].id
- drives[].sed_state
- drives[].state
- drives[].type
- total

**PARSED OUTPUT:**
```json
{
  "drives": [
    {
      "id": 0,
      "cage_pos": "1:1",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 1,
      "cage_pos": "1:2",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 2,
      "cage_pos": "1:3",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 3,
      "cage_pos": "1:4",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 4,
      "cage_pos": "1:5",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 5,
      "cage_pos": "1:6",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 6,
      "cage_pos": "1:7",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 7,
      "cage_pos": "1:8",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 8,
      "cage_pos": "1:9",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 9,
      "cage_pos": "1:10",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 10,
      "cage_pos": "1:11",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 11,
      "cage_pos": "1:12",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 12,
      "cage_pos": "1:13",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 13,
      "cage_pos": "1:14",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 14,
      "cage_pos": "1:15",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 15,
      "cage_pos": "1:16",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 16,
      "cage_pos": "1:17",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 17,
      "cage_pos": "1:18",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 18,
      "cage_pos": "1:19",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 19,
      "cage_pos": "1:20",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 20,
      "cage_pos": "1:21",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 21,
      "cage_pos": "1:22",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 22,
      "cage_pos": "1:23",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 23,
      "cage_pos": "1:24",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 24,
      "cage_pos": "41:1",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 25,
      "cage_pos": "41:2",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 26,
      "cage_pos": "41:3",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 27,
      "cage_pos": "41:4",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 28,
      "cage_pos": "41:5",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 29,
      "cage_pos": "41:6",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 30,
      "cage_pos": "41:7",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 31,
      "cage_pos": "41:8",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 32,
      "cage_pos": "41:9",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 33,
      "cage_pos": "41:10",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 34,
      "cage_pos": "41:11",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 35,
      "cage_pos": "41:12",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 36,
      "cage_pos": "41:13",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 37,
      "cage_pos": "41:14",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 38,
      "cage_pos": "41:15",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 39,
      "cage_pos": "41:16",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 40,
      "cage_pos": "41:17",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 41,
      "cage_pos": "41:18",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 42,
      "cage_pos": "41:19",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 43,
      "cage_pos": "41:20",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 44,
      "cage_pos": "41:21",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 45,
      "cage_pos": "41:22",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "fips_capable"
    },
    {
      "id": 46,
      "cage_pos": "41:23",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    },
    {
      "id": 47,
      "cage_pos": "41:24",
      "type": "SSD",
      "state": "normal",
      "detailed_state": "normal",
      "sed_state": "not_capable"
    }
  ],
  "total": 48
}
```

## FOR SHOWPD -I (Detailed Drive Info)

**CLI O/P:**
```
showpd -i
 Id CagePos State  ----Node_WWN---- --MFR-- -----Model------ ----Serial---- -FW_Rev- Protocol Type -----AdmissionTime-----
  0 41:1    normal 002538E44100E1D1 SAMSUNG AELN30T7P5xnEQRI S7PNNE0X400136 3R01     NVMe     QLC  2026-03-03 23:57:02 PST
  1 41:2    normal 002538E44100E25B SAMSUNG AELN30T7P5xnEQRI S7PNNE0X400274 3R01     NVMe     QLC  2026-03-03 23:57:02 PST
...
--------------------------------------------------------------------------------------------------------------------------
192 total
```

**PARSING FUNCTION:**
```javascript
function parseShowPdI(cliOutput) {
    const result = {
        drives: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        // Header
        if (/^Id\b.*\bCagePos\b.*\bState\b/i.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        // Separator
        if (/^-+$/.test(line))
            continue;

        // Footer
        const totalMatch = line.match(/^(\d+)\s+total$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1]);
            break;
        }

        const parts = line.split(/\s+/);

        if (parts.length < 12)
            continue;

        // ---------- Right side ----------

        const timezone = parts.pop();
        const time = parts.pop();
        const date = parts.pop();

        const driveType = parts.pop();
        const protocol = parts.pop();
        const firmwareRev = parts.pop();

        const admissionTime = `${date} ${time} ${timezone}`;

        // ---------- Left side ----------

        const id = Number(parts.shift());
        const cagePos = parts.shift();
        const state = parts.shift();

        if (Number.isNaN(id))
            continue;

        // ---------- Middle ----------

        const nodeWwn = parts.shift();

        if (!nodeWwn)
            continue;

        const manufacturer = parts.shift();

        if (!manufacturer)
            continue;

        // Remaining:
        // Model ... Serial

        if (parts.length < 2)
            continue;

        const serial = parts.pop();
        const model = parts.join(" ");

        result.drives.push({
            id,
            cage_pos: cagePos,
            state,
            node_wwn: nodeWwn,
            manufacturer,
            model,
            serial,
            firmware_rev: firmwareRev,
            protocol,
            drive_type: driveType,
            admission_time: admissionTime
        });
    }

    return result;
}
```

**EXTRACTED PARAMETERS:**
- drives[].admission_time
- drives[].cage_pos
- drives[].drive_type
- drives[].firmware_rev
- drives[].id
- drives[].manufacturer
- drives[].model
- drives[].node_wwn
- drives[].protocol
- drives[].serial
- drives[].state
- total

**PARSED OUTPUT:**
```json
{
  "drives": [
    {
      "id": 0,
      "cage_pos": "41:1",
      "state": "normal",
      "node_wwn": "002538E44100E1D1",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400136",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:02 PST"
    },
    {
      "id": 1,
      "cage_pos": "41:2",
      "state": "normal",
      "node_wwn": "002538E44100E25B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400274",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:02 PST"
    },
    {
      "id": 2,
      "cage_pos": "41:3",
      "state": "normal",
      "node_wwn": "002538E44100E286",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400317",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:03 PST"
    },
    {
      "id": 3,
      "cage_pos": "41:4",
      "state": "normal",
      "node_wwn": "002538E44100E1CB",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400130",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:04 PST"
    },
    {
      "id": 4,
      "cage_pos": "41:5",
      "state": "normal",
      "node_wwn": "002538E44100E1D4",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400139",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:05 PST"
    },
    {
      "id": 5,
      "cage_pos": "41:6",
      "state": "normal",
      "node_wwn": "002538E1415008EF",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100264",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:05 PST"
    },
    {
      "id": 6,
      "cage_pos": "41:7",
      "state": "normal",
      "node_wwn": "002538E44100E28F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400326",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:06 PST"
    },
    {
      "id": 7,
      "cage_pos": "41:8",
      "state": "normal",
      "node_wwn": "002538E1415007ED",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100006",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:06 PST"
    },
    {
      "id": 8,
      "cage_pos": "41:9",
      "state": "normal",
      "node_wwn": "002538E1415008F1",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100266",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:07 PST"
    },
    {
      "id": 9,
      "cage_pos": "41:10",
      "state": "normal",
      "node_wwn": "002538E1415008F0",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100265",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:07 PST"
    },
    {
      "id": 10,
      "cage_pos": "41:11",
      "state": "normal",
      "node_wwn": "002538E44100E290",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400327",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:08 PST"
    },
    {
      "id": 11,
      "cage_pos": "41:12",
      "state": "normal",
      "node_wwn": "002538E44100E293",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400330",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:08 PST"
    },
    {
      "id": 12,
      "cage_pos": "41:13",
      "state": "normal",
      "node_wwn": "002538E141500883",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100156",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:09 PST"
    },
    {
      "id": 13,
      "cage_pos": "41:14",
      "state": "normal",
      "node_wwn": "002538E841006262",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800743",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:09 PST"
    },
    {
      "id": 14,
      "cage_pos": "41:15",
      "state": "normal",
      "node_wwn": "002538E1415008E7",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100256",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:10 PST"
    },
    {
      "id": 15,
      "cage_pos": "41:16",
      "state": "normal",
      "node_wwn": "002538E84100626B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800752",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:10 PST"
    },
    {
      "id": 16,
      "cage_pos": "41:17",
      "state": "normal",
      "node_wwn": "002538E1415008EC",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100261",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:11 PST"
    },
    {
      "id": 17,
      "cage_pos": "41:18",
      "state": "normal",
      "node_wwn": "002538E1415008E9",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100258",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:11 PST"
    },
    {
      "id": 18,
      "cage_pos": "41:19",
      "state": "normal",
      "node_wwn": "002538E1415008F5",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100270",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:12 PST"
    },
    {
      "id": 19,
      "cage_pos": "41:20",
      "state": "normal",
      "node_wwn": "002538E1415008EA",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100259",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:12 PST"
    },
    {
      "id": 20,
      "cage_pos": "41:21",
      "state": "normal",
      "node_wwn": "002538E1415007F2",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100011",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:12 PST"
    },
    {
      "id": 21,
      "cage_pos": "41:22",
      "state": "normal",
      "node_wwn": "002538E141500834",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100077",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:13 PST"
    },
    {
      "id": 22,
      "cage_pos": "41:23",
      "state": "normal",
      "node_wwn": "002538E141500818",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100049",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:14 PST"
    },
    {
      "id": 23,
      "cage_pos": "41:24",
      "state": "normal",
      "node_wwn": "002538E1415007E9",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100002",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:14 PST"
    },
    {
      "id": 24,
      "cage_pos": "42:1",
      "state": "normal",
      "node_wwn": "002538E141500837",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100080",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:15 PST"
    },
    {
      "id": 25,
      "cage_pos": "42:2",
      "state": "normal",
      "node_wwn": "002538E44100E1EA",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400161",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:15 PST"
    },
    {
      "id": 26,
      "cage_pos": "42:3",
      "state": "normal",
      "node_wwn": "002538E44100E17B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400050",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:16 PST"
    },
    {
      "id": 27,
      "cage_pos": "42:4",
      "state": "normal",
      "node_wwn": "002538E1415008E5",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100254",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:16 PST"
    },
    {
      "id": 28,
      "cage_pos": "42:5",
      "state": "normal",
      "node_wwn": "002538E1415008C7",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100224",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:17 PST"
    },
    {
      "id": 29,
      "cage_pos": "42:6",
      "state": "normal",
      "node_wwn": "002538E141500867",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100128",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:17 PST"
    },
    {
      "id": 30,
      "cage_pos": "42:7",
      "state": "normal",
      "node_wwn": "002538E14150090C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100293",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:18 PST"
    },
    {
      "id": 31,
      "cage_pos": "42:8",
      "state": "normal",
      "node_wwn": "002538E84100625E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800739",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:18 PST"
    },
    {
      "id": 32,
      "cage_pos": "42:9",
      "state": "normal",
      "node_wwn": "002538E44100E29A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400337",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:18 PST"
    },
    {
      "id": 33,
      "cage_pos": "42:10",
      "state": "normal",
      "node_wwn": "002538E14150090B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100292",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:19 PST"
    },
    {
      "id": 34,
      "cage_pos": "42:11",
      "state": "normal",
      "node_wwn": "002538E141500832",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100075",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:19 PST"
    },
    {
      "id": 35,
      "cage_pos": "42:12",
      "state": "normal",
      "node_wwn": "002538E141500888",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100161",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:20 PST"
    },
    {
      "id": 36,
      "cage_pos": "42:13",
      "state": "normal",
      "node_wwn": "002538E14150086A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100131",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:20 PST"
    },
    {
      "id": 37,
      "cage_pos": "42:14",
      "state": "normal",
      "node_wwn": "002538E141500821",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100058",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:21 PST"
    },
    {
      "id": 38,
      "cage_pos": "42:15",
      "state": "normal",
      "node_wwn": "002538E1415008E8",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100257",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:21 PST"
    },
    {
      "id": 39,
      "cage_pos": "42:16",
      "state": "normal",
      "node_wwn": "002538E141500824",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100061",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:22 PST"
    },
    {
      "id": 40,
      "cage_pos": "42:17",
      "state": "normal",
      "node_wwn": "002538E1415008CF",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100232",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:22 PST"
    },
    {
      "id": 41,
      "cage_pos": "42:18",
      "state": "normal",
      "node_wwn": "002538E44100E29B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400338",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:23 PST"
    },
    {
      "id": 42,
      "cage_pos": "42:19",
      "state": "normal",
      "node_wwn": "002538E1415008D9",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100242",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:23 PST"
    },
    {
      "id": 43,
      "cage_pos": "42:20",
      "state": "normal",
      "node_wwn": "002538E44100E1ED",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400164",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:24 PST"
    },
    {
      "id": 44,
      "cage_pos": "42:21",
      "state": "normal",
      "node_wwn": "002538E1415008D3",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100236",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:25 PST"
    },
    {
      "id": 45,
      "cage_pos": "42:22",
      "state": "normal",
      "node_wwn": "002538E44100E27C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400307",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:25 PST"
    },
    {
      "id": 46,
      "cage_pos": "42:23",
      "state": "normal",
      "node_wwn": "002538E84100620E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800714",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:26 PST"
    },
    {
      "id": 47,
      "cage_pos": "42:24",
      "state": "normal",
      "node_wwn": "002538E8410061E9",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800702",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:26 PST"
    },
    {
      "id": 48,
      "cage_pos": "43:1",
      "state": "normal",
      "node_wwn": "002538E44100E1E6",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400157",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:26 PST"
    },
    {
      "id": 49,
      "cage_pos": "43:2",
      "state": "normal",
      "node_wwn": "002538E44100E1EB",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400162",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:27 PST"
    },
    {
      "id": 50,
      "cage_pos": "43:3",
      "state": "normal",
      "node_wwn": "002538E44100E299",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400336",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:27 PST"
    },
    {
      "id": 51,
      "cage_pos": "43:4",
      "state": "normal",
      "node_wwn": "002538E44100E1EF",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400166",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:28 PST"
    },
    {
      "id": 52,
      "cage_pos": "43:5",
      "state": "normal",
      "node_wwn": "002538E1415007F1",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100010",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:28 PST"
    },
    {
      "id": 53,
      "cage_pos": "43:6",
      "state": "normal",
      "node_wwn": "002538E1415008F7",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100272",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:29 PST"
    },
    {
      "id": 54,
      "cage_pos": "43:7",
      "state": "normal",
      "node_wwn": "002538E141500801",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100026",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:29 PST"
    },
    {
      "id": 55,
      "cage_pos": "43:8",
      "state": "normal",
      "node_wwn": "002538E1415007F4",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100013",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:30 PST"
    },
    {
      "id": 56,
      "cage_pos": "43:9",
      "state": "normal",
      "node_wwn": "002538E44100E248",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400255",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:30 PST"
    },
    {
      "id": 57,
      "cage_pos": "43:10",
      "state": "normal",
      "node_wwn": "002538E44100E288",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400319",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:31 PST"
    },
    {
      "id": 58,
      "cage_pos": "43:11",
      "state": "normal",
      "node_wwn": "002538E1415008F2",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100267",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:31 PST"
    },
    {
      "id": 59,
      "cage_pos": "43:12",
      "state": "normal",
      "node_wwn": "002538E44100E258",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400271",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:32 PST"
    },
    {
      "id": 60,
      "cage_pos": "43:13",
      "state": "normal",
      "node_wwn": "002538E44100E28B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400322",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:32 PST"
    },
    {
      "id": 61,
      "cage_pos": "43:14",
      "state": "normal",
      "node_wwn": "002538E44100E2A9",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400352",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:33 PST"
    },
    {
      "id": 62,
      "cage_pos": "43:15",
      "state": "normal",
      "node_wwn": "002538E44100E2A7",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400350",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:33 PST"
    },
    {
      "id": 63,
      "cage_pos": "43:16",
      "state": "normal",
      "node_wwn": "002538E44100E29E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400341",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:34 PST"
    },
    {
      "id": 64,
      "cage_pos": "43:17",
      "state": "normal",
      "node_wwn": "002538E44100E289",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400320",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:34 PST"
    },
    {
      "id": 65,
      "cage_pos": "43:18",
      "state": "normal",
      "node_wwn": "002538E1415008F4",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100269",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:35 PST"
    },
    {
      "id": 66,
      "cage_pos": "43:19",
      "state": "normal",
      "node_wwn": "002538E44100E25E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400277",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:36 PST"
    },
    {
      "id": 67,
      "cage_pos": "43:20",
      "state": "normal",
      "node_wwn": "002538E841006261",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800742",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:36 PST"
    },
    {
      "id": 68,
      "cage_pos": "43:21",
      "state": "normal",
      "node_wwn": "002538E44100E1CA",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400129",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:37 PST"
    },
    {
      "id": 69,
      "cage_pos": "43:22",
      "state": "normal",
      "node_wwn": "002538E44100E1D0",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400135",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:37 PST"
    },
    {
      "id": 70,
      "cage_pos": "43:23",
      "state": "normal",
      "node_wwn": "002538E44100E182",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400057",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:38 PST"
    },
    {
      "id": 71,
      "cage_pos": "43:24",
      "state": "normal",
      "node_wwn": "002538E841006269",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800750",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:38 PST"
    },
    {
      "id": 72,
      "cage_pos": "44:1",
      "state": "normal",
      "node_wwn": "002538E44100E270",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400295",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:39 PST"
    },
    {
      "id": 73,
      "cage_pos": "44:2",
      "state": "normal",
      "node_wwn": "002538E44100E26A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400289",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:39 PST"
    },
    {
      "id": 74,
      "cage_pos": "44:3",
      "state": "normal",
      "node_wwn": "002538E84100626C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800753",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:40 PST"
    },
    {
      "id": 75,
      "cage_pos": "44:4",
      "state": "normal",
      "node_wwn": "002538E841006263",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800744",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:40 PST"
    },
    {
      "id": 76,
      "cage_pos": "44:5",
      "state": "normal",
      "node_wwn": "002538E141500886",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100159",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:40 PST"
    },
    {
      "id": 77,
      "cage_pos": "44:6",
      "state": "normal",
      "node_wwn": "002538E141500803",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100028",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:41 PST"
    },
    {
      "id": 78,
      "cage_pos": "44:7",
      "state": "normal",
      "node_wwn": "002538E141500871",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100138",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:41 PST"
    },
    {
      "id": 79,
      "cage_pos": "44:8",
      "state": "normal",
      "node_wwn": "002538E14150084A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100099",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:42 PST"
    },
    {
      "id": 80,
      "cage_pos": "44:9",
      "state": "normal",
      "node_wwn": "002538E14150086D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100134",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:42 PST"
    },
    {
      "id": 81,
      "cage_pos": "44:10",
      "state": "normal",
      "node_wwn": "002538E141500848",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100097",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:43 PST"
    },
    {
      "id": 82,
      "cage_pos": "44:11",
      "state": "normal",
      "node_wwn": "002538E14150080C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100037",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:43 PST"
    },
    {
      "id": 83,
      "cage_pos": "44:12",
      "state": "normal",
      "node_wwn": "002538E14150080F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100040",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:44 PST"
    },
    {
      "id": 84,
      "cage_pos": "44:13",
      "state": "normal",
      "node_wwn": "002538E1415007FE",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100023",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:44 PST"
    },
    {
      "id": 85,
      "cage_pos": "44:14",
      "state": "normal",
      "node_wwn": "002538E14150086B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100132",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:44 PST"
    },
    {
      "id": 86,
      "cage_pos": "44:15",
      "state": "normal",
      "node_wwn": "002538E14150086C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100133",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:45 PST"
    },
    {
      "id": 87,
      "cage_pos": "44:16",
      "state": "normal",
      "node_wwn": "002538E141500841",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100090",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:45 PST"
    },
    {
      "id": 88,
      "cage_pos": "44:17",
      "state": "normal",
      "node_wwn": "002538E44100E253",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400266",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:46 PST"
    },
    {
      "id": 89,
      "cage_pos": "44:18",
      "state": "normal",
      "node_wwn": "002538E44100E24D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400260",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:47 PST"
    },
    {
      "id": 90,
      "cage_pos": "44:19",
      "state": "normal",
      "node_wwn": "002538E44100E287",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400318",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:47 PST"
    },
    {
      "id": 91,
      "cage_pos": "44:20",
      "state": "normal",
      "node_wwn": "002538E44100E254",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400267",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:48 PST"
    },
    {
      "id": 92,
      "cage_pos": "44:21",
      "state": "normal",
      "node_wwn": "002538E44100E2A3",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400346",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:48 PST"
    },
    {
      "id": 93,
      "cage_pos": "44:22",
      "state": "normal",
      "node_wwn": "002538E44100E259",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400272",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:49 PST"
    },
    {
      "id": 94,
      "cage_pos": "44:23",
      "state": "normal",
      "node_wwn": "002538E44100E285",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400316",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:49 PST"
    },
    {
      "id": 95,
      "cage_pos": "44:24",
      "state": "normal",
      "node_wwn": "002538E44100E2A1",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400344",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:50 PST"
    },
    {
      "id": 96,
      "cage_pos": "45:1",
      "state": "normal",
      "node_wwn": "002538E141500904",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100285",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:50 PST"
    },
    {
      "id": 97,
      "cage_pos": "45:2",
      "state": "normal",
      "node_wwn": "002538E141500902",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100283",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:51 PST"
    },
    {
      "id": 98,
      "cage_pos": "45:3",
      "state": "normal",
      "node_wwn": "002538E141500903",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100284",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:51 PST"
    },
    {
      "id": 99,
      "cage_pos": "45:4",
      "state": "normal",
      "node_wwn": "002538E141500901",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100282",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:52 PST"
    },
    {
      "id": 100,
      "cage_pos": "45:5",
      "state": "normal",
      "node_wwn": "002538E14150083D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100086",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:52 PST"
    },
    {
      "id": 101,
      "cage_pos": "45:6",
      "state": "normal",
      "node_wwn": "002538E141500826",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100063",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:52 PST"
    },
    {
      "id": 102,
      "cage_pos": "45:7",
      "state": "normal",
      "node_wwn": "002538E141500892",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100171",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:53 PST"
    },
    {
      "id": 103,
      "cage_pos": "45:8",
      "state": "normal",
      "node_wwn": "002538E141500807",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100032",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:53 PST"
    },
    {
      "id": 104,
      "cage_pos": "45:9",
      "state": "normal",
      "node_wwn": "002538E44100E1D3",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400138",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:54 PST"
    },
    {
      "id": 105,
      "cage_pos": "45:10",
      "state": "normal",
      "node_wwn": "002538E84100620F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800715",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:54 PST"
    },
    {
      "id": 106,
      "cage_pos": "45:11",
      "state": "normal",
      "node_wwn": "002538E841006271",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800758",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:55 PST"
    },
    {
      "id": 107,
      "cage_pos": "45:12",
      "state": "normal",
      "node_wwn": "002538E841006268",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800749",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:55 PST"
    },
    {
      "id": 108,
      "cage_pos": "45:13",
      "state": "normal",
      "node_wwn": "002538E84100624A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800734",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:56 PST"
    },
    {
      "id": 109,
      "cage_pos": "45:14",
      "state": "normal",
      "node_wwn": "002538E44100E25F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400278",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:56 PST"
    },
    {
      "id": 110,
      "cage_pos": "45:15",
      "state": "normal",
      "node_wwn": "002538E44100E265",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400284",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:57 PST"
    },
    {
      "id": 111,
      "cage_pos": "45:16",
      "state": "normal",
      "node_wwn": "002538E141500831",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100074",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:58 PST"
    },
    {
      "id": 112,
      "cage_pos": "45:17",
      "state": "normal",
      "node_wwn": "002538E44100E267",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400286",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:58 PST"
    },
    {
      "id": 113,
      "cage_pos": "45:18",
      "state": "normal",
      "node_wwn": "002538E44100E26B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400290",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:59 PST"
    },
    {
      "id": 114,
      "cage_pos": "45:19",
      "state": "normal",
      "node_wwn": "002538E44100E170",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400039",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:59 PST"
    },
    {
      "id": 115,
      "cage_pos": "45:20",
      "state": "normal",
      "node_wwn": "002538E44100E181",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400056",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:57:59 PST"
    },
    {
      "id": 116,
      "cage_pos": "45:21",
      "state": "normal",
      "node_wwn": "002538E44100E275",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400300",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:00 PST"
    },
    {
      "id": 117,
      "cage_pos": "45:22",
      "state": "normal",
      "node_wwn": "002538E44100E1EC",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400163",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:00 PST"
    },
    {
      "id": 118,
      "cage_pos": "45:23",
      "state": "normal",
      "node_wwn": "002538E44100E2A0",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400343",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:01 PST"
    },
    {
      "id": 119,
      "cage_pos": "45:24",
      "state": "normal",
      "node_wwn": "002538E44100E28A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400321",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:01 PST"
    },
    {
      "id": 120,
      "cage_pos": "46:1",
      "state": "normal",
      "node_wwn": "002538E44100E2A4",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400347",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:02 PST"
    },
    {
      "id": 121,
      "cage_pos": "46:2",
      "state": "normal",
      "node_wwn": "002538E44100E249",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400256",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:02 PST"
    },
    {
      "id": 122,
      "cage_pos": "46:3",
      "state": "normal",
      "node_wwn": "002538E44100E251",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400264",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:03 PST"
    },
    {
      "id": 123,
      "cage_pos": "46:4",
      "state": "normal",
      "node_wwn": "002538E84100626F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800756",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:03 PST"
    },
    {
      "id": 124,
      "cage_pos": "46:5",
      "state": "normal",
      "node_wwn": "002538E44100E264",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400283",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:04 PST"
    },
    {
      "id": 125,
      "cage_pos": "46:6",
      "state": "normal",
      "node_wwn": "002538E44100E284",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400315",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:04 PST"
    },
    {
      "id": 126,
      "cage_pos": "46:7",
      "state": "normal",
      "node_wwn": "002538E44100E25C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400275",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:05 PST"
    },
    {
      "id": 127,
      "cage_pos": "46:8",
      "state": "normal",
      "node_wwn": "002538E44100E266",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400285",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:05 PST"
    },
    {
      "id": 128,
      "cage_pos": "46:9",
      "state": "normal",
      "node_wwn": "002538E44100E24C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400259",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:06 PST"
    },
    {
      "id": 129,
      "cage_pos": "46:10",
      "state": "normal",
      "node_wwn": "002538E44100E2A5",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400348",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:06 PST"
    },
    {
      "id": 130,
      "cage_pos": "46:11",
      "state": "normal",
      "node_wwn": "002538E44100E2A6",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400349",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:07 PST"
    },
    {
      "id": 131,
      "cage_pos": "46:12",
      "state": "normal",
      "node_wwn": "002538E44100E2A8",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400351",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:07 PST"
    },
    {
      "id": 132,
      "cage_pos": "46:13",
      "state": "normal",
      "node_wwn": "002538E44100E1D6",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400141",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:08 PST"
    },
    {
      "id": 133,
      "cage_pos": "46:14",
      "state": "normal",
      "node_wwn": "002538E44100E1D5",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400140",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:09 PST"
    },
    {
      "id": 134,
      "cage_pos": "46:15",
      "state": "normal",
      "node_wwn": "002538E44100E17C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400051",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:09 PST"
    },
    {
      "id": 135,
      "cage_pos": "46:16",
      "state": "normal",
      "node_wwn": "002538E44100E1D7",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400142",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:10 PST"
    },
    {
      "id": 136,
      "cage_pos": "46:17",
      "state": "normal",
      "node_wwn": "002538E44100E24E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400261",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:10 PST"
    },
    {
      "id": 137,
      "cage_pos": "46:18",
      "state": "normal",
      "node_wwn": "002538E44100E28E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400325",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:11 PST"
    },
    {
      "id": 138,
      "cage_pos": "46:19",
      "state": "normal",
      "node_wwn": "002538E1415008D4",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100237",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:11 PST"
    },
    {
      "id": 139,
      "cage_pos": "46:20",
      "state": "normal",
      "node_wwn": "002538E14150088C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100165",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:12 PST"
    },
    {
      "id": 140,
      "cage_pos": "46:21",
      "state": "normal",
      "node_wwn": "002538E44100E291",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400328",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:12 PST"
    },
    {
      "id": 141,
      "cage_pos": "46:22",
      "state": "normal",
      "node_wwn": "002538E44100E28C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400323",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:13 PST"
    },
    {
      "id": 142,
      "cage_pos": "46:23",
      "state": "normal",
      "node_wwn": "002538E44100E28D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400324",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:14 PST"
    },
    {
      "id": 143,
      "cage_pos": "46:24",
      "state": "normal",
      "node_wwn": "002538E44100E292",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400329",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:14 PST"
    },
    {
      "id": 144,
      "cage_pos": "47:1",
      "state": "normal",
      "node_wwn": "002538E44100E24B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400258",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:14 PST"
    },
    {
      "id": 145,
      "cage_pos": "47:2",
      "state": "normal",
      "node_wwn": "002538E84100624C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800736",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:15 PST"
    },
    {
      "id": 146,
      "cage_pos": "47:3",
      "state": "normal",
      "node_wwn": "002538E44100E1B2",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400105",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:15 PST"
    },
    {
      "id": 147,
      "cage_pos": "47:4",
      "state": "normal",
      "node_wwn": "002538E44100E24A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400257",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:16 PST"
    },
    {
      "id": 148,
      "cage_pos": "47:5",
      "state": "normal",
      "node_wwn": "002538E141500868",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100129",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:16 PST"
    },
    {
      "id": 149,
      "cage_pos": "47:6",
      "state": "normal",
      "node_wwn": "002538E14150081B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100052",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:17 PST"
    },
    {
      "id": 150,
      "cage_pos": "47:7",
      "state": "normal",
      "node_wwn": "002538E44100E1B8",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400111",
      "firmware_rev": "R001",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:17 PST"
    },
    {
      "id": 151,
      "cage_pos": "47:8",
      "state": "normal",
      "node_wwn": "002538E141500820",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100057",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:18 PST"
    },
    {
      "id": 152,
      "cage_pos": "47:9",
      "state": "normal",
      "node_wwn": "002538E1415007FF",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100024",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:18 PST"
    },
    {
      "id": 153,
      "cage_pos": "47:10",
      "state": "normal",
      "node_wwn": "002538E1415007EC",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100005",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:19 PST"
    },
    {
      "id": 154,
      "cage_pos": "47:11",
      "state": "normal",
      "node_wwn": "002538E44100F56B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400429",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:20 PST"
    },
    {
      "id": 155,
      "cage_pos": "47:12",
      "state": "normal",
      "node_wwn": "002538E14150084D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100102",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:20 PST"
    },
    {
      "id": 156,
      "cage_pos": "49:1",
      "state": "normal",
      "node_wwn": "002538E44100E192",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400073",
      "firmware_rev": "R001",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:22 PST"
    },
    {
      "id": 157,
      "cage_pos": "49:2",
      "state": "normal",
      "node_wwn": "002538E44100E26E",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400293",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:23 PST"
    },
    {
      "id": 158,
      "cage_pos": "49:3",
      "state": "normal",
      "node_wwn": "002538E44100E271",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400296",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:23 PST"
    },
    {
      "id": 159,
      "cage_pos": "49:4",
      "state": "normal",
      "node_wwn": "002538E44100E274",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400299",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:24 PST"
    },
    {
      "id": 160,
      "cage_pos": "49:5",
      "state": "normal",
      "node_wwn": "002538E44100E27B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400306",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:24 PST"
    },
    {
      "id": 161,
      "cage_pos": "49:6",
      "state": "normal",
      "node_wwn": "002538E44100E29C",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400339",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:24 PST"
    },
    {
      "id": 162,
      "cage_pos": "49:7",
      "state": "normal",
      "node_wwn": "002538E44100E29F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400342",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:25 PST"
    },
    {
      "id": 163,
      "cage_pos": "49:8",
      "state": "normal",
      "node_wwn": "002538E14150093F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100320",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:25 PST"
    },
    {
      "id": 164,
      "cage_pos": "49:9",
      "state": "normal",
      "node_wwn": "002538E141500850",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100105",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:26 PST"
    },
    {
      "id": 165,
      "cage_pos": "49:10",
      "state": "normal",
      "node_wwn": "002538E141500800",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100025",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:26 PST"
    },
    {
      "id": 166,
      "cage_pos": "49:11",
      "state": "normal",
      "node_wwn": "002538E141500897",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100176",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:27 PST"
    },
    {
      "id": 167,
      "cage_pos": "49:12",
      "state": "normal",
      "node_wwn": "002538E14150084B",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100100",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:27 PST"
    },
    {
      "id": 168,
      "cage_pos": "50:1",
      "state": "normal",
      "node_wwn": "002538E44100E283",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400314",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:28 PST"
    },
    {
      "id": 169,
      "cage_pos": "50:2",
      "state": "normal",
      "node_wwn": "002538E44100E280",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400311",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:28 PST"
    },
    {
      "id": 170,
      "cage_pos": "50:3",
      "state": "normal",
      "node_wwn": "002538E1415008D7",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100240",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:29 PST"
    },
    {
      "id": 171,
      "cage_pos": "50:4",
      "state": "normal",
      "node_wwn": "002538E44100E25D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400276",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:29 PST"
    },
    {
      "id": 172,
      "cage_pos": "50:5",
      "state": "normal",
      "node_wwn": "002538E44100E262",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400281",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:30 PST"
    },
    {
      "id": 173,
      "cage_pos": "50:6",
      "state": "normal",
      "node_wwn": "002538E44100E25A",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400273",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:31 PST"
    },
    {
      "id": 174,
      "cage_pos": "50:7",
      "state": "normal",
      "node_wwn": "002538E44100E27F",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400310",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:31 PST"
    },
    {
      "id": 175,
      "cage_pos": "50:8",
      "state": "normal",
      "node_wwn": "002538E44100E1EE",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400165",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:32 PST"
    },
    {
      "id": 176,
      "cage_pos": "50:9",
      "state": "normal",
      "node_wwn": "002538E84100626D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800754",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:32 PST"
    },
    {
      "id": 177,
      "cage_pos": "50:10",
      "state": "normal",
      "node_wwn": "002538E841006267",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800748",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:33 PST"
    },
    {
      "id": 178,
      "cage_pos": "50:11",
      "state": "normal",
      "node_wwn": "002538E44100E297",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400334",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:33 PST"
    },
    {
      "id": 179,
      "cage_pos": "50:12",
      "state": "normal",
      "node_wwn": "002538E44100E294",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400331",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-03 23:58:34 PST"
    },
    {
      "id": 180,
      "cage_pos": "48:3",
      "state": "normal",
      "node_wwn": "002538E44100E295",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400332",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:13 PST"
    },
    {
      "id": 181,
      "cage_pos": "48:4",
      "state": "normal",
      "node_wwn": "002538E44100E1F0",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400167",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:13 PST"
    },
    {
      "id": 182,
      "cage_pos": "48:5",
      "state": "normal",
      "node_wwn": "002538E44100E2A2",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400345",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:14 PST"
    },
    {
      "id": 183,
      "cage_pos": "48:6",
      "state": "normal",
      "node_wwn": "002538E44100E29D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400340",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:14 PST"
    },
    {
      "id": 184,
      "cage_pos": "48:7",
      "state": "normal",
      "node_wwn": "002538E141500835",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100078",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:15 PST"
    },
    {
      "id": 185,
      "cage_pos": "48:8",
      "state": "normal",
      "node_wwn": "002538E1415007EA",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNG0X100003",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:15 PST"
    },
    {
      "id": 186,
      "cage_pos": "48:9",
      "state": "normal",
      "node_wwn": "002538E84100624D",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800737",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:16 PST"
    },
    {
      "id": 187,
      "cage_pos": "48:10",
      "state": "normal",
      "node_wwn": "002538E841006270",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X800757",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:16 PST"
    },
    {
      "id": 188,
      "cage_pos": "48:11",
      "state": "normal",
      "node_wwn": "002538E44100E296",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400333",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:17 PST"
    },
    {
      "id": 189,
      "cage_pos": "48:12",
      "state": "normal",
      "node_wwn": "002538E44100E298",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400335",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:21:17 PST"
    },
    {
      "id": 190,
      "cage_pos": "48:1",
      "state": "normal",
      "node_wwn": "002538E44100E272",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400297",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:35:35 PST"
    },
    {
      "id": 191,
      "cage_pos": "48:2",
      "state": "normal",
      "node_wwn": "002538E44100E1D2",
      "manufacturer": "SAMSUNG",
      "model": "AELN30T7P5xnEQRI",
      "serial": "S7PNNE0X400137",
      "firmware_rev": "3R01",
      "protocol": "NVMe",
      "drive_type": "QLC",
      "admission_time": "2026-03-04 01:35:55 PST"
    }
  ],
  "total": 192
}
```

## FOR SHOWHOST (SSH CLI Format — Id / Name / Persona / WWN / Port)

**CLI O/P:**
```
showhost
Id Name            Persona      -WWN/iSCSI_Name/NQN- Port
  4 host-alpha-001 Generic-ALUA 1000D000000000A1     0:3:1
                                1000D000000000A2     3:3:1
  0 host-beta-002  Generic-ALUA 51402EC0000000B1     0:3:1
                                51402EC0000000B2     3:3:1
```

**PARSING FUNCTION:**
```javascript
function parseShowHostSSH(cliOutput) {
    const result = {
        hosts: [],
        total: null
    };

    const lines = cliOutput.split(/\r?\n/);

    let inTable = false;
    let currentHost = null;

    for (const rawLine of lines) {
        const line = rawLine;

        if (/-WWN\/iSCSI_Name\/NQN-/.test(line)) {
            inTable = true;
            continue;
        }

        if (!inTable)
            continue;

        if (!line.trim())
            continue;

        if (/^-+$/.test(line.trim()))
            continue;

        const totalMatch = line.trim().match(/^(\d+)\s+total$/i);
        if (totalMatch) {
            result.total = Number(totalMatch[1]);
            break;
        }

        const parts = line.trim().split(/\s+/);

        if (parts.length < 2)
            continue;

        //----------------------------------------------------
        // Continuation line
        //----------------------------------------------------

        if (!/^(\d+|--)$/.test(parts[0])) {

            if (!currentHost)
                continue;

            const wwn = parts[0];
            const port = parts[1];

            currentHost.wwns.push({
                wwn,
                port
            });

            continue;
        }

        //----------------------------------------------------
        // New host
        //----------------------------------------------------

        if (parts.length < 5)
            continue;

        const id = parts.shift();
        const name = parts.shift();

        const port = parts.pop();
        const wwn = parts.pop();

        const persona = parts.join(" ");

        currentHost = {
            id: id === "--" ? null : Number(id),
            name,
            persona,
            wwns: [
                {
                    wwn,
                    port
                }
            ]
        };

        result.hosts.push(currentHost);
    }

    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "hosts": [
    { "id": 4, "name": "host-alpha-001", "persona": "Generic-ALUA", "wwns": [{ "wwn": "1000D000000000A1", "port": "0:3:1" }, { "wwn": "1000D000000000A2", "port": "3:3:1" }] },
    { "id": 0, "name": "host-beta-002",  "persona": "Generic-ALUA", "wwns": [{ "wwn": "51402EC0000000B1", "port": "0:3:1" }, { "wwn": "51402EC0000000B2", "port": "3:3:1" }] }
  ],
  "total": null
}
```

## FOR SHOWPORTDEV NS -NOHDTOT

**CLI O/P:**
```
showportdev ns -nohdtot 0:3:1
0xc0200 0x00 0x00 2FF70000DUMMY001 20310000DUMMY001 0x8800 0x0012 n/a 0x0800 20310000DUMMY001 HPE Alletra Storage MP - DUMMY000999 - fw:105600   0:3:1
0xc1100 0x0a 0x00 2000AAAABBBB1001 1000AAAABBBB1001 0x0000 0x0000 0x0000 0x0000 20310000DUMMY001 Emulex SN1600E1P FV14.0.499.29 DV14.0.499.31 HN:host-lnx-222.example.local OS:Linux  host-lnx-222
0x641600 0x05 0x00 2000AAAABBBB1004 1000AAAABBBB1004 0x0000 0x0000 0x0000 0x0000 20310000DUMMY001 Emulex SN1200E2P FV14.4.473.14 DV14.4.0.40 HN:host-esx-131.example.local OS:VMware ESXi 8.0.3  -
```

**PARSING FUNCTION:**
```javascript
function parseShowPortDevNS(cliOutput) {
    const result = {
        array_port: null,
        entries: []
    };

    const lines = cliOutput.split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || line.startsWith("showportdev"))
            continue;

        const parts = line.split(/\s+/);

        // Fixed binary columns
        if (parts.length < 11)
            continue;

        const nodeWwn = parts[3];
        const portWwn = parts[4];

        const description = parts.slice(10).join(" ");

        //--------------------------------------------------
        // Array self entry
        //--------------------------------------------------

        if (!description.includes("HN:")) {

            const portMatch = description.match(/(\d+:\d+:\d+)$/);

            if (portMatch && !result.array_port)
                result.array_port = portMatch[1];

            continue;
        }

        //--------------------------------------------------
        // Tagged fields
        //--------------------------------------------------

        const hostname =
            description.match(/\bHN:(\S+)/)?.[1] ?? null;

        const os =
            description.match(/\bOS:(.+?)(?=\s+(?:HN:|FV|DV|$))/)?.[1]?.trim() ??
            description.match(/\bOS:(.+?)(?=\s+\S+$)/)?.[1]?.trim() ??
            null;

        const fw =
            description.match(/\bFV([\d.]+)/)?.[1] ?? null;

        const driver =
            description.match(/\bDV([\d.]+)/)?.[1] ?? null;

        //--------------------------------------------------
        // HBA model
        //--------------------------------------------------

        let hbaModel = null;

        const firstTag = description.search(/\b(?:FV|DV|HN:|OS:)/);

        if (firstTag > 0)
            hbaModel = description.substring(0, firstTag).trim();

        //--------------------------------------------------
        // Connected host
        //--------------------------------------------------

        const lastToken = parts[parts.length - 1];

        result.entries.push({
            node_wwn: nodeWwn,
            port_wwn: portWwn,
            hostname,
            os,
            hba_fw: fw,
            hba_driver: driver,
            hba_model: hbaModel,
            path_active: lastToken !== "-",
            connected_host: lastToken === "-" ? null : lastToken
        });
    }

    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "array_port": "0:3:1",
  "entries": [
    { "node_wwn": "2000AAAABBBB1001", "port_wwn": "1000AAAABBBB1001", "hostname": "host-lnx-222.example.local", "os": "Linux", "hba_fw": "14.0.499.29", "hba_driver": "14.0.499.31", "hba_model": "Emulex SN1600E1P", "path_active": true,  "connected_host": "host-lnx-222" },
    { "node_wwn": "2000AAAABBBB1004", "port_wwn": "1000AAAABBBB1004", "hostname": "host-esx-131.example.local", "os": "VMware ESXi 8.0.3", "hba_fw": "14.4.473.14", "hba_driver": "14.4.0.40", "hba_model": "Emulex SN1200E2P", "path_active": false, "connected_host": null }
  ]
}
```

## FOR FABRICSHOW (Brocade FC Switch)

**CLI O/P:**
```
fabricshow
Switch ID   Worldwide Name          Enet IP Addr    FC IP Addr      Name
-------------------------------------------------------------------------
  1: dmyc01 10:00:aa:aa:aa:aa:aa:01 192.168.10.11   0.0.0.0         "sw-core-01"
  2: dmyc02 10:00:aa:aa:aa:aa:aa:02 192.168.10.12   0.0.0.0         "sw-core-02"
  3: dmyc03 10:00:aa:aa:aa:aa:aa:03 192.168.10.13   0.0.0.0         "sw-core-03"
  4: dmyc04 10:00:aa:aa:aa:aa:aa:04 192.168.10.14   0.0.0.0         "sw-core-04"
  5: dmyc05 10:00:aa:aa:aa:aa:aa:05 192.168.10.15   0.0.0.0         "sw-core-05"
  6: dmyc06 10:00:aa:aa:aa:aa:aa:06 192.168.10.16   0.0.0.0         "sw-core-06"
  7: dmyc07 10:00:aa:aa:aa:aa:aa:07 192.168.10.17   0.0.0.0         "sw-core-07"
  8: dmyc08 10:00:aa:aa:aa:aa:aa:08 192.168.10.18   0.0.0.0         "sw-core-08"
  9: dmyc09 10:00:aa:aa:aa:aa:aa:09 192.168.10.19   0.0.0.0         "sw-core-09"
 10: dmyc0a 10:00:aa:aa:aa:aa:aa:0a 192.168.10.20   0.0.0.0         "sw-core-10"
 11: dmyc0b 10:00:aa:aa:aa:aa:aa:0b 192.168.10.21   0.0.0.0         "sw-core-11"
 12: dmyc0c 10:00:aa:aa:aa:aa:aa:0c 192.168.10.22   0.0.0.0         "sw-core-12"
 13: dmyc0d 10:00:aa:aa:aa:aa:aa:0d 192.168.10.23   0.0.0.0         "sw-core-13"
 14: dmyc0e 10:00:aa:aa:aa:aa:aa:0e 192.168.10.24   0.0.0.0         "sw-core-14"
 15: dmyc0f 10:00:aa:aa:aa:aa:aa:0f 192.168.10.25   0.0.0.0         "sw-core-15"
 16: dmyc10 10:00:aa:aa:aa:aa:aa:10 192.168.10.26   0.0.0.0         "sw-core-16"
 17: dmyc11 10:00:aa:aa:aa:aa:aa:11 192.168.10.27   0.0.0.0         "sw-core-17"
 18: dmyc12 10:00:aa:aa:aa:aa:aa:12 192.168.10.28   0.0.0.0         "sw-core-18"
 19: dmyc13 10:00:aa:aa:aa:aa:aa:13 192.168.10.29   0.0.0.0         "sw-core-19"
 30: dmyc1e 10:00:aa:aa:aa:aa:aa:1e 192.168.10.30   0.0.0.0         "sw-core-30"
 31: dmyc1f 10:00:aa:aa:aa:aa:aa:1f 192.168.10.31   0.0.0.0         "sw-core-31"
 32: dmyc20 10:00:aa:aa:aa:aa:aa:20 192.168.10.32   0.0.0.0         "sw-core-32"
 61: dmyc3d 10:00:aa:aa:aa:aa:aa:3d 192.168.10.61   0.0.0.0         "sw-edge-61"
 66: dmyc42 10:00:aa:aa:aa:aa:aa:42 192.168.10.66   0.0.0.0         "sw-edge-66"
 67: dmyc43 10:00:aa:aa:aa:aa:aa:43 192.168.10.67   0.0.0.0         "sw-edge-67"
 73: dmyc49 10:00:aa:aa:aa:aa:aa:49 192.168.10.73   0.0.0.0         "sw-edge-73"
 74: dmyc4a 10:00:aa:aa:aa:aa:aa:4a 192.168.10.74   0.0.0.0         "sw-edge-74"
 75: dmyc4b 10:00:aa:aa:aa:aa:aa:4b 192.168.10.75   0.0.0.0         "sw-edge-75"
 76: dmyc4c 10:00:aa:aa:aa:aa:aa:4c 192.168.10.76   0.0.0.0         "sw-edge-76"
 77: dmyc4d 10:00:aa:aa:aa:aa:aa:4d 192.168.10.77   0.0.0.0         "sw-edge-77"
 78: dmyc4e 10:00:aa:aa:aa:aa:aa:4e 192.168.10.78   0.0.0.0         "sw-edge-78"
 79: dmyc4f 10:00:aa:aa:aa:aa:aa:4f 192.168.10.79   0.0.0.0         "sw-edge-79"
 97: dmyc61 10:00:aa:aa:aa:aa:aa:61 192.168.10.97   0.0.0.0         "sw-edge-97"
 99: dmyc63 10:00:aa:aa:aa:aa:aa:63 192.168.10.99   0.0.0.0         "sw-edge-99"
100: dmyc64 10:00:aa:aa:aa:aa:aa:64 192.168.10.100  0.0.0.0         "sw-edge-100"
101: dmyc65 10:00:aa:aa:aa:aa:aa:65 192.168.10.101  0.0.0.0         "sw-edge-101"
116: dmyc74 10:00:aa:aa:aa:aa:aa:74 192.168.10.116  0.0.0.0         "sw-edge-116"
117: dmyc75 10:00:aa:aa:aa:aa:aa:75 192.168.10.117  0.0.0.0         "sw-edge-117"
173: dmycad 10:00:aa:aa:aa:aa:aa:ad 192.168.10.173  0.0.0.0         "sw-edge-173"
201: dmycc9 10:00:aa:aa:aa:aa:aa:c9 192.168.10.201  0.0.0.0         "sw-edge-201"

The Fabric has 40 switches
Fabric Name: FABRIC_DUMMY_01
```

**PARSING FUNCTION:**
```javascript
function parseFabricShow(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    const result = { fabric_name: null, switches: [], total: null };
    let parsing = false;
    for (let line of lines) {
        if (line.includes('Switch ID') && line.includes('Worldwide Name')) { parsing = true; continue; }
        if (/^-{20,}/.test(line.trim())) continue;
        if (!parsing) continue;
        const totalMatch = line.match(/The Fabric has (\d+) switches/);
        if (totalMatch) { result.total = parseInt(totalMatch[1], 10); continue; }
        const nameMatch = line.match(/Fabric Name:\s*(.+)/);
        if (nameMatch) { result.fabric_name = nameMatch[1].trim(); continue; }
        // Switch data row: "  1: dmyc01 10:00:aa:... 192.168.10.11  0.0.0.0  "sw-core-01""
        const rowMatch = line.match(/^\s*(\d+):\s+(\S+)\s+([\da-f:]+)\s+([\d.]+)\s+[\d.]+\s+"?([^"]+)"?/i);
        if (rowMatch) {
            result.switches.push({
                domain_id: parseInt(rowMatch[1], 10),
                domain_hex: rowMatch[2],
                wwn: rowMatch[3],
                ip: rowMatch[4],
                name: rowMatch[5].replace(/"/g, '').trim()
            });
        }
    }
    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "fabric_name": "FABRIC_DUMMY_01",
  "switches": [
    {
      "domain_id": 1,
      "domain_hex": "dmyc01",
      "wwn": "10:00:aa:aa:aa:aa:aa:01",
      "ip": "192.168.10.11",
      "name": "sw-core-01"
    },
    {
      "domain_id": 2,
      "domain_hex": "dmyc02",
      "wwn": "10:00:aa:aa:aa:aa:aa:02",
      "ip": "192.168.10.12",
      "name": "sw-core-02"
    },
    {
      "domain_id": 3,
      "domain_hex": "dmyc03",
      "wwn": "10:00:aa:aa:aa:aa:aa:03",
      "ip": "192.168.10.13",
      "name": "sw-core-03"
    },
    {
      "domain_id": 4,
      "domain_hex": "dmyc04",
      "wwn": "10:00:aa:aa:aa:aa:aa:04",
      "ip": "192.168.10.14",
      "name": "sw-core-04"
    },
    {
      "domain_id": 5,
      "domain_hex": "dmyc05",
      "wwn": "10:00:aa:aa:aa:aa:aa:05",
      "ip": "192.168.10.15",
      "name": "sw-core-05"
    },
    {
      "domain_id": 6,
      "domain_hex": "dmyc06",
      "wwn": "10:00:aa:aa:aa:aa:aa:06",
      "ip": "192.168.10.16",
      "name": "sw-core-06"
    },
    {
      "domain_id": 7,
      "domain_hex": "dmyc07",
      "wwn": "10:00:aa:aa:aa:aa:aa:07",
      "ip": "192.168.10.17",
      "name": "sw-core-07"
    },
    {
      "domain_id": 8,
      "domain_hex": "dmyc08",
      "wwn": "10:00:aa:aa:aa:aa:aa:08",
      "ip": "192.168.10.18",
      "name": "sw-core-08"
    },
    {
      "domain_id": 9,
      "domain_hex": "dmyc09",
      "wwn": "10:00:aa:aa:aa:aa:aa:09",
      "ip": "192.168.10.19",
      "name": "sw-core-09"
    },
    {
      "domain_id": 10,
      "domain_hex": "dmyc0a",
      "wwn": "10:00:aa:aa:aa:aa:aa:0a",
      "ip": "192.168.10.20",
      "name": "sw-core-10"
    },
    {
      "domain_id": 11,
      "domain_hex": "dmyc0b",
      "wwn": "10:00:aa:aa:aa:aa:aa:0b",
      "ip": "192.168.10.21",
      "name": "sw-core-11"
    },
    {
      "domain_id": 12,
      "domain_hex": "dmyc0c",
      "wwn": "10:00:aa:aa:aa:aa:aa:0c",
      "ip": "192.168.10.22",
      "name": "sw-core-12"
    },
    {
      "domain_id": 13,
      "domain_hex": "dmyc0d",
      "wwn": "10:00:aa:aa:aa:aa:aa:0d",
      "ip": "192.168.10.23",
      "name": "sw-core-13"
    },
    {
      "domain_id": 14,
      "domain_hex": "dmyc0e",
      "wwn": "10:00:aa:aa:aa:aa:aa:0e",
      "ip": "192.168.10.24",
      "name": "sw-core-14"
    },
    {
      "domain_id": 15,
      "domain_hex": "dmyc0f",
      "wwn": "10:00:aa:aa:aa:aa:aa:0f",
      "ip": "192.168.10.25",
      "name": "sw-core-15"
    },
    {
      "domain_id": 16,
      "domain_hex": "dmyc10",
      "wwn": "10:00:aa:aa:aa:aa:aa:10",
      "ip": "192.168.10.26",
      "name": "sw-core-16"
    },
    {
      "domain_id": 17,
      "domain_hex": "dmyc11",
      "wwn": "10:00:aa:aa:aa:aa:aa:11",
      "ip": "192.168.10.27",
      "name": "sw-core-17"
    },
    {
      "domain_id": 18,
      "domain_hex": "dmyc12",
      "wwn": "10:00:aa:aa:aa:aa:aa:12",
      "ip": "192.168.10.28",
      "name": "sw-core-18"
    },
    {
      "domain_id": 19,
      "domain_hex": "dmyc13",
      "wwn": "10:00:aa:aa:aa:aa:aa:13",
      "ip": "192.168.10.29",
      "name": "sw-core-19"
    },
    {
      "domain_id": 30,
      "domain_hex": "dmyc1e",
      "wwn": "10:00:aa:aa:aa:aa:aa:1e",
      "ip": "192.168.10.30",
      "name": "sw-core-30"
    },
    {
      "domain_id": 31,
      "domain_hex": "dmyc1f",
      "wwn": "10:00:aa:aa:aa:aa:aa:1f",
      "ip": "192.168.10.31",
      "name": "sw-core-31"
    },
    {
      "domain_id": 32,
      "domain_hex": "dmyc20",
      "wwn": "10:00:aa:aa:aa:aa:aa:20",
      "ip": "192.168.10.32",
      "name": "sw-core-32"
    },
    {
      "domain_id": 61,
      "domain_hex": "dmyc3d",
      "wwn": "10:00:aa:aa:aa:aa:aa:3d",
      "ip": "192.168.10.61",
      "name": "sw-edge-61"
    },
    {
      "domain_id": 66,
      "domain_hex": "dmyc42",
      "wwn": "10:00:aa:aa:aa:aa:aa:42",
      "ip": "192.168.10.66",
      "name": "sw-edge-66"
    },
    {
      "domain_id": 67,
      "domain_hex": "dmyc43",
      "wwn": "10:00:aa:aa:aa:aa:aa:43",
      "ip": "192.168.10.67",
      "name": "sw-edge-67"
    },
    {
      "domain_id": 73,
      "domain_hex": "dmyc49",
      "wwn": "10:00:aa:aa:aa:aa:aa:49",
      "ip": "192.168.10.73",
      "name": "sw-edge-73"
    },
    {
      "domain_id": 74,
      "domain_hex": "dmyc4a",
      "wwn": "10:00:aa:aa:aa:aa:aa:4a",
      "ip": "192.168.10.74",
      "name": "sw-edge-74"
    },
    {
      "domain_id": 75,
      "domain_hex": "dmyc4b",
      "wwn": "10:00:aa:aa:aa:aa:aa:4b",
      "ip": "192.168.10.75",
      "name": "sw-edge-75"
    },
    {
      "domain_id": 76,
      "domain_hex": "dmyc4c",
      "wwn": "10:00:aa:aa:aa:aa:aa:4c",
      "ip": "192.168.10.76",
      "name": "sw-edge-76"
    },
    {
      "domain_id": 77,
      "domain_hex": "dmyc4d",
      "wwn": "10:00:aa:aa:aa:aa:aa:4d",
      "ip": "192.168.10.77",
      "name": "sw-edge-77"
    },
    {
      "domain_id": 78,
      "domain_hex": "dmyc4e",
      "wwn": "10:00:aa:aa:aa:aa:aa:4e",
      "ip": "192.168.10.78",
      "name": "sw-edge-78"
    },
    {
      "domain_id": 79,
      "domain_hex": "dmyc4f",
      "wwn": "10:00:aa:aa:aa:aa:aa:4f",
      "ip": "192.168.10.79",
      "name": "sw-edge-79"
    },
    {
      "domain_id": 97,
      "domain_hex": "dmyc61",
      "wwn": "10:00:aa:aa:aa:aa:aa:61",
      "ip": "192.168.10.97",
      "name": "sw-edge-97"
    },
    {
      "domain_id": 99,
      "domain_hex": "dmyc63",
      "wwn": "10:00:aa:aa:aa:aa:aa:63",
      "ip": "192.168.10.99",
      "name": "sw-edge-99"
    },
    {
      "domain_id": 100,
      "domain_hex": "dmyc64",
      "wwn": "10:00:aa:aa:aa:aa:aa:64",
      "ip": "192.168.10.100",
      "name": "sw-edge-100"
    },
    {
      "domain_id": 101,
      "domain_hex": "dmyc65",
      "wwn": "10:00:aa:aa:aa:aa:aa:65",
      "ip": "192.168.10.101",
      "name": "sw-edge-101"
    },
    {
      "domain_id": 116,
      "domain_hex": "dmyc74",
      "wwn": "10:00:aa:aa:aa:aa:aa:74",
      "ip": "192.168.10.116",
      "name": "sw-edge-116"
    },
    {
      "domain_id": 117,
      "domain_hex": "dmyc75",
      "wwn": "10:00:aa:aa:aa:aa:aa:75",
      "ip": "192.168.10.117",
      "name": "sw-edge-117"
    },
    {
      "domain_id": 173,
      "domain_hex": "dmycad",
      "wwn": "10:00:aa:aa:aa:aa:aa:ad",
      "ip": "192.168.10.173",
      "name": "sw-edge-173"
    },
    {
      "domain_id": 201,
      "domain_hex": "dmycc9",
      "wwn": "10:00:aa:aa:aa:aa:aa:c9",
      "ip": "192.168.10.201",
      "name": "sw-edge-201"
    }
  ],
  "total": 40
}
```

## FOR SWITCHSHOW (Brocade FC Switch)

**CLI O/P:**
```
switchshow
switchName:     sw-fabric-99
switchType:     109.1
switchState:    Online
switchMode:     Native
switchRole:     Subordinate
switchDomain:   99
switchId:       dmyc63
switchWwn:      10:00:aa:bb:cc:dd:ee:99
zoning:         ON (FABRIC_DUMMY_1)
switchBeacon:   OFF
FC Router:      OFF
Fabric Name:    FABRIC_DUMMY_01
HIF Mode:       OFF
Allow XISL Use: OFF
LS Attributes:  [FID: 128, Base Switch: No, Default Switch: Yes, Address Mode 0]

Index Port Address  Media Speed   State       Proto
==================================================
   0   0   630000   id    N16     Online      FC  E-Port  10:00:aa:bb:cc:00:00:08 "sw-bridge-08" (Trunk master)
   1   1   630100   id    N16     Online      FC  E-Port  (Trunk port, master is Port  0 )
   2   2   630200   id    N16     Online      FC  E-Port  10:00:aa:bb:cc:00:00:01 "sw-core-01" (upstream)(Trunk master)
   3   3   630300   id    N16     Online      FC  E-Port  (Trunk port, master is Port  2 )
   4   4   630400   id    N16     No_Light    FC
   5   5   630500   id    N16     No_Light    FC
   6   6   630600   id    N16     No_Light    FC
   7   7   630700   id    N16     No_Light    FC
   8   8   630800   id    N16     No_Light    FC
   9   9   630900   id    N16     No_Light    FC
  10  10   630a00   id    N16     No_Light    FC
  11  11   630b00   id    N16     No_Light    FC
  12  12   630c00   id    N16     No_Light    FC
  13  13   630d00   id    N16     No_Light    FC
  14  14   630e00   id    N16     No_Light    FC
  15  15   630f00   id    N16     No_Light    FC
  16  16   631000   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:10
  17  17   631100   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:11
  18  18   631200   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:12
  19  19   631300   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:13
  20  20   631400   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:14
  21  21   631500   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:15
  22  22   631600   id    N16     No_Light    FC
  23  23   631700   id    N16     No_Light    FC
  24  24   631800   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:18
  25  25   631900   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:19
  26  26   631a00   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:1a
  27  27   631b00   id    N16     Online      FC  F-Port  10:00:11:22:33:44:55:1b
  28  28   631c00   id    N16     No_Light    FC
  29  29   631d00   id    N16     No_Light    FC
  30  30   631e00   id    N16     No_Light    FC
  31  31   631f00   id    N16     No_Light    FC
  32  32   632000   id    N16     No_Light    FC
  33  33   632100   id    N16     No_Light    FC
  34  34   632200   id    N16     No_Light    FC
  35  35   632300   id    N16     No_Light    FC
  36  36   632400   id    N16     No_Light    FC
  37  37   632500   id    N16     No_Light    FC
  38  38   632600   id    N16     No_Light    FC
  39  39   632700   id    N16     No_Light    FC
  40  40   632800   id    N16     No_Light    FC
  41  41   632900   id    N16     No_Light    FC
  42  42   632a00   id    N16     No_Light    FC
  43  43   632b00   id    N16     No_Light    FC
  44  44   632c00   id    N16     No_Light    FC
  45  45   632d00   id    N16     No_Light    FC
  46  46   632e00   id    N16     No_Light    FC
  47  47   632f00   id    N16     No_Light    FC
```

**PARSING FUNCTION:**
```javascript
function parseSwitchShow(cliOutput) {
    const result = {
        info: {},
        ports: [],
        port_summary: {
            online: 0,
            no_light: 0,
            e_ports: 0,
            f_ports: 0
        }
    };

    const lines = cliOutput.split(/\r?\n/);

    let inPorts = false;

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (!line)
            continue;

        //--------------------------------------------------
        // Header key:value pairs
        //--------------------------------------------------

        if (!inPorts) {

            const kv = line.match(/^([^:]+):\s*(.*)$/);

            if (kv) {

                const key = kv[1].trim();
                const value = kv[2].trim();

                switch (key) {

                    case "switchName":
                        result.info.name = value;
                        break;

                    case "switchState":
                        result.info.state = value;
                        break;

                    case "switchRole":
                        result.info.role = value;
                        break;

                    case "switchDomain":
                        result.info.domain = value;
                        break;

                    case "switchWwn":
                        result.info.wwn = value;
                        break;

                    case "zoning":
                        result.info.zoning = value;
                        break;

                    case "Fabric Name":
                        result.info.fabric_name = value;
                        break;
                }

                continue;
            }
        }

        //--------------------------------------------------
        // Beginning of port table
        //--------------------------------------------------

        if (/^Index\s+Port\s+Address/i.test(line)) {
            inPorts = true;
            continue;
        }

        if (!inPorts)
            continue;

        if (/^=+$/.test(line))
            continue;

        //--------------------------------------------------
        // Port row
        //--------------------------------------------------

        const parts = line.trim().split(/\s+/);

        if (parts.length < 6)
            continue;

        const port = {
            index: Number(parts[0]),
            port: Number(parts[1]),
            address: parts[2],
            state: parts[5]
        };

        const typeToken = parts.find(p =>
            p === "E-Port" ||
            p === "F-Port" ||
            p === "G-Port" ||
            p === "L-Port"
        );

        if (typeToken)
            port.type = typeToken;

        //--------------------------------------------------
        // Summary
        //--------------------------------------------------

        if (port.state === "Online")
            result.port_summary.online++;

        if (port.state === "No_Light")
            result.port_summary.no_light++;

        switch (port.type) {

            case "E-Port":
                result.port_summary.e_ports++;
                break;

            case "F-Port":
                result.port_summary.f_ports++;
                break;
        }

        result.ports.push(port);
    }

    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "info": {
    "name": "sw-fabric-99",
    "state": "Online",
    "role": "Subordinate",
    "domain": "99",
    "wwn": "10:00:aa:bb:cc:dd:ee:99",
    "zoning": "ON (FABRIC_DUMMY_1)",
    "fabric_name": "FABRIC_DUMMY_01"
  },
  "ports": [
    {
      "index": 0,
      "port": 0,
      "address": "630000",
      "state": "Online",
      "type": "E-Port"
    },
    {
      "index": 1,
      "port": 1,
      "address": "630100",
      "state": "Online",
      "type": "E-Port"
    },
    {
      "index": 2,
      "port": 2,
      "address": "630200",
      "state": "Online",
      "type": "E-Port"
    },
    {
      "index": 3,
      "port": 3,
      "address": "630300",
      "state": "Online",
      "type": "E-Port"
    },
    {
      "index": 4,
      "port": 4,
      "address": "630400",
      "state": "No_Light"
    },
    {
      "index": 5,
      "port": 5,
      "address": "630500",
      "state": "No_Light"
    },
    {
      "index": 6,
      "port": 6,
      "address": "630600",
      "state": "No_Light"
    },
    {
      "index": 7,
      "port": 7,
      "address": "630700",
      "state": "No_Light"
    },
    {
      "index": 8,
      "port": 8,
      "address": "630800",
      "state": "No_Light"
    },
    {
      "index": 9,
      "port": 9,
      "address": "630900",
      "state": "No_Light"
    },
    {
      "index": 10,
      "port": 10,
      "address": "630a00",
      "state": "No_Light"
    },
    {
      "index": 11,
      "port": 11,
      "address": "630b00",
      "state": "No_Light"
    },
    {
      "index": 12,
      "port": 12,
      "address": "630c00",
      "state": "No_Light"
    },
    {
      "index": 13,
      "port": 13,
      "address": "630d00",
      "state": "No_Light"
    },
    {
      "index": 14,
      "port": 14,
      "address": "630e00",
      "state": "No_Light"
    },
    {
      "index": 15,
      "port": 15,
      "address": "630f00",
      "state": "No_Light"
    },
    {
      "index": 16,
      "port": 16,
      "address": "631000",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 17,
      "port": 17,
      "address": "631100",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 18,
      "port": 18,
      "address": "631200",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 19,
      "port": 19,
      "address": "631300",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 20,
      "port": 20,
      "address": "631400",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 21,
      "port": 21,
      "address": "631500",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 22,
      "port": 22,
      "address": "631600",
      "state": "No_Light"
    },
    {
      "index": 23,
      "port": 23,
      "address": "631700",
      "state": "No_Light"
    },
    {
      "index": 24,
      "port": 24,
      "address": "631800",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 25,
      "port": 25,
      "address": "631900",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 26,
      "port": 26,
      "address": "631a00",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 27,
      "port": 27,
      "address": "631b00",
      "state": "Online",
      "type": "F-Port"
    },
    {
      "index": 28,
      "port": 28,
      "address": "631c00",
      "state": "No_Light"
    },
    {
      "index": 29,
      "port": 29,
      "address": "631d00",
      "state": "No_Light"
    },
    {
      "index": 30,
      "port": 30,
      "address": "631e00",
      "state": "No_Light"
    },
    {
      "index": 31,
      "port": 31,
      "address": "631f00",
      "state": "No_Light"
    },
    {
      "index": 32,
      "port": 32,
      "address": "632000",
      "state": "No_Light"
    },
    {
      "index": 33,
      "port": 33,
      "address": "632100",
      "state": "No_Light"
    },
    {
      "index": 34,
      "port": 34,
      "address": "632200",
      "state": "No_Light"
    },
    {
      "index": 35,
      "port": 35,
      "address": "632300",
      "state": "No_Light"
    },
    {
      "index": 36,
      "port": 36,
      "address": "632400",
      "state": "No_Light"
    },
    {
      "index": 37,
      "port": 37,
      "address": "632500",
      "state": "No_Light"
    },
    {
      "index": 38,
      "port": 38,
      "address": "632600",
      "state": "No_Light"
    },
    {
      "index": 39,
      "port": 39,
      "address": "632700",
      "state": "No_Light"
    },
    {
      "index": 40,
      "port": 40,
      "address": "632800",
      "state": "No_Light"
    },
    {
      "index": 41,
      "port": 41,
      "address": "632900",
      "state": "No_Light"
    },
    {
      "index": 42,
      "port": 42,
      "address": "632a00",
      "state": "No_Light"
    },
    {
      "index": 43,
      "port": 43,
      "address": "632b00",
      "state": "No_Light"
    },
    {
      "index": 44,
      "port": 44,
      "address": "632c00",
      "state": "No_Light"
    },
    {
      "index": 45,
      "port": 45,
      "address": "632d00",
      "state": "No_Light"
    },
    {
      "index": 46,
      "port": 46,
      "address": "632e00",
      "state": "No_Light"
    },
    {
      "index": 47,
      "port": 47,
      "address": "632f00",
      "state": "No_Light"
    }
  ],
  "port_summary": {
    "online": 14,
    "no_light": 34,
    "e_ports": 4,
    "f_ports": 10
  }
}
```

## FOR SYSTOOL -C FC_HOST (Linux HBA FC Info)

**CLI O/P:**
```
systool -c fc_host -v | grep -E 'Class Device|port_state|port_name|speed'
  Class Device = "host5"
  Class Device path = "/sys/devices/pci0000:09/0000:09:00.0/0000:0a:00.0/host5/fc_host/host5"
    port_name           = "0x1000aaaabbbb0001"
    port_state          = "Online"
    speed               = "16 Gbit"
    supported_speeds    = "4 Gbit, 8 Gbit, 16 Gbit"
  Class Device = "host6"
  Class Device path = "/sys/devices/pci0000:09/0000:09:00.0/0000:0a:00.1/host6/fc_host/host6"
    port_name           = "0x1000aaaabbbb0002"
    port_state          = "Online"
    speed               = "16 Gbit"
    supported_speeds    = "4 Gbit, 8 Gbit, 16 Gbit"
```

**PARSING FUNCTION:**
```javascript
function parseSystoolFCHost(cliOutput) {
    const result = {
        adapter: {
            model: null,
            driver: null,
            pci_slots: []
        },
        hbas: []
    };

    const lines = cliOutput.split(/\r?\n/);

    let current = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        //--------------------------------------------------
        // Optional summary lines
        //--------------------------------------------------

        let m;

        if ((m = line.match(/^HBA:\s*(.+)$/i))) {
            result.adapter.model = m[1];
            continue;
        }

        if ((m = line.match(/^Driver:\s*(.+)$/i))) {
            result.adapter.driver = m[1];
            continue;
        }

        if ((m = line.match(/^PCI slots:\s*(.+)$/i))) {
            result.adapter.pci_slots =
                m[1]
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean);

            continue;
        }

        //--------------------------------------------------
        // New fc_host
        //--------------------------------------------------

        if ((m = line.match(/^Class Device\s*=\s*"?(host\d+)"?/i))) {

            current = {
                host_id: m[1],
                port_name: null,
                port_state: null,
                speed: null,
                supported_speeds: null
            };

            result.hbas.push(current);
            continue;
        }

        if (!current)
            continue;

        //--------------------------------------------------
        // Attributes
        //--------------------------------------------------

        if ((m = line.match(/^port_name\s*=\s*"?(.*?)"?$/i))) {
            current.port_name = m[1];
            continue;
        }

        if ((m = line.match(/^port_state\s*=\s*"?(.*?)"?$/i))) {
            current.port_state = m[1];
            continue;
        }

        if ((m = line.match(/^speed\s*=\s*"?(.*?)"?$/i))) {
            current.speed = m[1];
            continue;
        }

        if ((m = line.match(/^supported_speeds\s*=\s*"?(.*?)"?$/i))) {
            current.supported_speeds = m[1];
            continue;
        }
    }

    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "hbas": [
    {
      "host_id": "host5",
      "port_name": "0x1000aaaabbbb0001",
      "port_state": "Online\"",
      "speed": "16 Gbit",
      "supported_speeds": "4 Gbit, 8 Gbit, 16 Gbit"
    },
    {
      "host_id": "host6",
      "port_name": "0x1000aaaabbbb0002",
      "port_state": "Online\"",
      "speed": "16 Gbit",
      "supported_speeds": "4 Gbit, 8 Gbit, 16 Gbit"
    }
  ]
}
```

## FOR LSPCI (Linux FC PCI Adapters)

**CLI O/P:**
```
lspci -nnk | grep -A3 -i 'fibre|fc|emulex|qlogic|lpfc|qlgc'
0a:00.0 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)
        Subsystem: Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]
        Kernel driver in use: lpfc
        Kernel modules: lpfc
0a:00.1 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)
        Subsystem: Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]
        Kernel driver in use: lpfc
        Kernel modules: lpfc
1f:00.0 PCI bridge [0604]: Intel Corporation Sky Lake-E PCI Express Root Port A [8086:2030] (rev 04)
        Kernel driver in use: pcieport
1f:05.0 System peripheral [0880]: Intel Corporation Sky Lake-E VT-d [8086:2034] (rev 04)

HBA:       HPE StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter (Emulex LPe32000)
Driver:    lpfc
PCI slots: 0a:00.0, 0a:00.1
```

**PARSING FUNCTION:**
```javascript
function parseLspciFC(cliOutput) {
    const result = {
        adapters: []
    };

    const lines = cliOutput.split(/\r?\n/);

    let current = null;

    for (const rawLine of lines) {
        const line = rawLine;

        //--------------------------------------------------
        // Beginning of a PCI device
        //--------------------------------------------------

        const pciMatch = line.match(/^([0-9a-f]{2}:[0-9a-f]{2}\.[0-7])\s+(.+)$/i);

        if (pciMatch) {

            // Finish previous device
            current = null;

            const description = pciMatch[2];

            // Only keep Fibre Channel adapters
            if (
                /Fibre Channel/i.test(description) ||
                /\bEmulex\b/i.test(description) ||
                /\bQLogic\b/i.test(description)
            ) {
                current = {
                    pci_slot: pciMatch[1],
                    description: line.trim(),
                    subsystem: null,
                    driver: null,
                    modules: null
                };

                result.adapters.push(current);
            }

            continue;
        }

        if (!current)
            continue;

        //--------------------------------------------------
        // Attribute lines
        //--------------------------------------------------

        const trimmed = line.trim();

        const sub = trimmed.match(/^Subsystem:\s*(.+)$/i);
        if (sub) {
            current.subsystem = sub[1];
            continue;
        }

        const drv = trimmed.match(/^Kernel driver in use:\s*(.+)$/i);
        if (drv) {
            current.driver = drv[1];
            continue;
        }

        const mod = trimmed.match(/^Kernel modules:\s*(.+)$/i);
        if (mod) {
            current.modules = mod[1];
            continue;
        }
    }

    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "adapters": [
    {
      "pci_slot": "0a:00.0",
      "description": "0a:00.0 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)",
      "subsystem": "Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]",
      "driver": "lpfc",
      "modules": "lpfc"
    },
    {
      "pci_slot": "0a:00.1",
      "description": "0a:00.1 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)",
      "subsystem": "Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]",
      "driver": "lpfc",
      "modules": "lpfc"
    }
  ]
}
```
