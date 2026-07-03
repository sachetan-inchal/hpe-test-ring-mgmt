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
    const lines = cliOutput.split(/\r?\n/);
    
    const result = {
        release_version: null,
        release_type: null,
        components: []
    };
    
    let inTable = false;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Parse first line: "Release version 10.6.0.40"
        if (line.startsWith("Release version")) {
            const match = line.match(/Release version\s+(\S+)/);
            if (match) result.release_version = match[1];
            continue;
        }
        
        // Parse second line: "Release Type: Standard Support Release"
        if (line.startsWith("Release Type:")) {
            const match = line.match(/Release Type:\s+(.+)/);
            if (match) result.release_type = match[1].trim();
            continue;
        }
        
        // Detect table header
        if (line.includes("Component Name") && line.includes("Version")) {
            inTable = true;
            continue;
        }
        
        // Skip empty lines
        if (!line.trim()) continue;
        
        // Parse table rows (after header)
        if (inTable) {
            // Split by 2+ spaces (table uses spaces for alignment)
            const parts = line.trim().split(/\s{2,}/);
            if (parts.length >= 2) {
                const version = parts[parts.length - 1];
                const name = parts.slice(0, -1).join(" ").trim();
                if (name && version) {
                    result.components.push({
                        name: name,
                        version: version
                    });
                }
            }
        }
    }
    
    return result;
}
```

**PARSED OUTPUT:** 

```json
// Example output:
{
  "release_version": "10.6.0.40",
  "release_type": "Standard Support Release",
  "components": [
    { "name": "CLI Server", "version": "10.6.0.40" },
    { "name": "CLI Client", "version": "10.6.0.40" },
    { "name": "System Manager", "version": "10.6.0.40" },
    { "name": "Kernel", "version": "10.6.0.38" },
    { "name": "IO Stack", "version": "10.6.0.40" },
    { "name": "Drive Firmware", "version": "10.6.0.40" },
    { "name": "Enclosure Firmware", "version": "10.6.0.40" },
    { "name": "Switch Firmware", "version": "10.15.1010" },
    { "name": "Upgrade Tool", "version": "643 (250602-10.6.0)" }
  ]
}
```
## FOR SHOWSYS

**CLI O/P (Variant 1 - Compact):**
```
showsys
ID -Name- --------Model--------- --Serial-- Nodes Master TotalCap   AllocCap   FreeCap FailedCap
0xD0001 s9999  HPE Alletra Storage MP DUMMY000999     2      0 703070208 536439706 118486118         0
```

**CLI O/P (Variant 2 - Expanded with MiB header):**
```
showsys
                                                                     ------------------(MiB)------------------
     ID -Name- ------------Model------------ --Serial-- Nodes Master TotalCap    AllocCap    FreeCap FailedCap
0x7F065 s4634  HPE Alletra Storage MP B10240 4UW0004634     4      0 5624758272 328458240 5263330304         0
```

**PARSING FUNCTION:**
```javascript
function parseShowSys(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);

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

    // Find data line
    let dataLine = null;
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.includes("ID") && line.includes("Name")) continue;
        if (line.includes("---")) continue;
        if (line.includes("(MiB)")) continue;

        if (line.match(/^(0x[0-9A-F]+|\w+)\s+\S+/)) {
            dataLine = line;
            break;
        }
    }

    if (!dataLine) return result;

    // Normalize spacing (critical fix)
    const parts = dataLine.trim().split(/\s+/);

    if (parts.length < 10) return result;

    result.id = parts[0];
    result.name = parts[1].replace(/-/g, '');

    // Detect serial dynamically
    let serialIndex = -1;
    for (let i = 2; i < parts.length; i++) {
        if (/^[A-Z0-9]{6,}$/.test(parts[i])) {
            serialIndex = i;
            break;
        }
    }

    if (serialIndex === -1) return result;

    // Model = everything between name and serial
    result.model = parts.slice(2, serialIndex).join(" ");
    result.serial = parts[serialIndex];

    const remaining = parts.slice(serialIndex + 1);

    if (remaining.length >= 6) {
        result.nodes = parseInt(remaining[0], 10);
        result.master = parseInt(remaining[1], 10);
        result.total_cap = parseInt(remaining[2], 10);
        result.alloc_cap = parseInt(remaining[3], 10);
        result.free_cap = parseInt(remaining[4], 10);
        result.failed_cap = parseInt(remaining[5], 10);
    }

    return result;
}
```

**PARSED OUTPUT (Variant 1):**
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

**PARSED OUTPUT (Variant 2):**
```json
{
  "id": "0x7F065",
  "name": "s4634",
  "model": "HPE Alletra Storage MP B10240",
  "serial": "4UW0004634",
  "nodes": 4,
  "master": 0,
  "total_cap": 5624758272,
  "alloc_cap": 328458240,
  "free_cap": 5263330304,
  "failed_cap": 0
}
```
## FOR SHOWNODE

**CLI O/P (Variant 1):**
```
shownode
Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------
   0 4UW0004634-0      1:1 Yes    Yes         515539 2026-03-10 01:25:24 PDT
   1 4UW0004634-1      1:2 No     Yes         515539 2026-03-10 01:25:27 PDT
   2 4UW0004634-2      2:1 No     Yes         515539 2026-03-10 01:25:29 PDT
   3 4UW0004634-3      2:2 No     Yes         515539 2026-03-10 01:25:00 PDT
```

**CLI O/P (Variant 2):**
```
shownode
Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------
   0 ARRAYDUMMY-0       1:1 Yes    Yes         257499 2026-03-11 21:44:19 PDT
   1 ARRAYDUMMY-1       1:2 No     Yes         257499 2026-03-11 21:54:14 PDT
```

**PARSING FUNCTION:**
```javascript
function parseShowNode(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    
    const result = {
        nodes: []
    };
    
    let parsing = false;
    let headerFound = false;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Detect header line
        if (line.includes("Node") && line.includes("Name") && line.includes("Encl:Bay")) {
            headerFound = true;
            parsing = true;
            continue;
        }
        
        // Skip dashed separator lines
        if (/^[-]{10,}/.test(line)) {
            continue;
        }
        
        // Parse data rows
        if (parsing && headerFound && line.trim()) {
            // Split by whitespace, but preserve the Name which may contain hyphens
            const parts = line.trim().split(/\s+/);
            
            // Expected pattern: [NodeID, Name, Encl:Bay, Master, InCluster, Mem(MiB), Up_Since_Date, Up_Since_Time, Timezone]
            if (parts.length >= 9) {
                // Node ID (first column)
                const nodeId = parseInt(parts[0], 10);
                
                // Name (second column) - may contain hyphens like "4UW0004634-0"
                const name = parts[1];
                
                // Encl:Bay (third column) - format like "1:1"
                const enclBay = parts[2];
                
                // Master (fourth column) - "Yes" or "No"
                const isMaster = parts[3] === "Yes";
                
                // InCluster (fifth column) - "Yes" or "No"
                const inCluster = parts[4] === "Yes";
                
                // Memory in MiB (sixth column)
                const memMiB = parseInt(parts[5], 10);
                
                // Up_Since: combine date, time, and timezone
                const upSinceDate = parts[6];
                const upSinceTime = parts[7];
                const timezone = parts[8];
                const upSince = `${upSinceDate} ${upSinceTime} ${timezone}`;
                
                result.nodes.push({
                    node_id: nodeId,
                    name: name,
                    encl_bay: enclBay,
                    is_master: isMaster,
                    in_cluster: inCluster,
                    mem_mib: memMiB,
                    up_since: upSince
                });
            }
        }
    }
    
    return result;
}
```

**PARSED OUTPUT (Variant 1):**
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

**PARSED OUTPUT (Variant 2):**
```json
{
  "nodes": [
    {
      "node_id": 0,
      "name": "ARRAYDUMMY-0",
      "encl_bay": "1:1",
      "is_master": true,
      "in_cluster": true,
      "mem_mib": 257499,
      "up_since": "2026-03-11 21:44:19 PDT"
    },
    {
      "node_id": 1,
      "name": "ARRAYDUMMY-1",
      "encl_bay": "1:2",
      "is_master": false,
      "in_cluster": true,
      "mem_mib": 257499,
      "up_since": "2026-03-11 21:54:14 PDT"
    }
  ]
}
```
## FOR SHOWPORT (Token-Based with N:S:P Decomposition)

**CLI O/P (Example 1):**
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

**CLI O/P (Example 2):**
```
showport
N:S:P      Mode     State --Node_WWN/IP--- -Port_WWN/HW_Addr- Type Protocol Label
0:1:1 initiator     ready       16.1.14.90       946DAED6F21A disk     NVMe  DP-1
0:1:2 initiator     ready       16.1.15.90       946DAED6F21B disk     NVMe  DP-2
0:2:1 initiator     ready         16.1.8.1       946DAED6F32E disk     NVMe  DP-1
0:2:2 initiator     ready         16.1.9.1       946DAED6F32F disk     NVMe  DP-2
0:3:1    target     ready 2FF70002AC07F065   20310002AC07F065 host       FC     -
0:3:2    target loss_sync 2FF70002AC07F065   20320002AC07F065 free       FC     -
0:3:3    target loss_sync 2FF70002AC07F065   20330002AC07F065 free       FC     -
0:3:4    target loss_sync 2FF70002AC07F065   20340002AC07F065 free       FC     -
0:4:1    target     ready       20.4.16.34       40A6B78A9A30 file       IP     -
0:4:2    target     ready       20.4.26.34       40A6B78A9A31 file       IP     -
0:4:3      peer   offline                -       40A6B78A9A32 free       IP     -
0:4:4      peer   offline                -       40A6B78A9A33 free       IP     -
1:1:1 initiator     ready       16.1.14.91       946DAED6F06A disk     NVMe  DP-1
1:1:2 initiator     ready       16.1.15.91       946DAED6F06B disk     NVMe  DP-2
1:2:1 initiator     ready         16.1.8.2       946DAED6F00A disk     NVMe  DP-1
1:2:2 initiator     ready         16.1.9.2       946DAED6F00B disk     NVMe  DP-2
1:3:1    target     ready 2FF70002AC07F065   21310002AC07F065 host       FC     -
1:3:2    target loss_sync 2FF70002AC07F065   21320002AC07F065 free       FC     -
1:3:3    target loss_sync 2FF70002AC07F065   21330002AC07F065 free       FC     -
1:3:4    target loss_sync 2FF70002AC07F065   21340002AC07F065 free       FC     -
1:4:1    target     ready      20.14.16.34       40A6B78A9850 file       IP     -
1:4:2    target     ready      20.14.26.34       40A6B78A9851 file       IP     -
1:4:3      peer   offline                -       40A6B78A9852 free       IP     -
1:4:4      peer   offline                -       40A6B78A9853 free       IP     -
2:1:1 initiator     ready       16.1.14.92       946DAED6F220 disk     NVMe  DP-1
2:1:2 initiator     ready       16.1.15.92       946DAED6F221 disk     NVMe  DP-2
2:2:1 initiator     ready         16.1.8.3       946DAED6F17E disk     NVMe  DP-1
2:2:2 initiator     ready         16.1.9.3       946DAED6F17F disk     NVMe  DP-2
2:3:1    target     ready 2FF70002AC07F065   22310002AC07F065 host       FC     -
2:3:2    target loss_sync 2FF70002AC07F065   22320002AC07F065 free       FC     -
2:3:3    target loss_sync 2FF70002AC07F065   22330002AC07F065 free       FC     -
2:3:4    target loss_sync 2FF70002AC07F065   22340002AC07F065 free       FC     -
2:4:1    target     ready      20.24.16.34       40A6B78A9810 file       IP     -
2:4:2    target     ready      20.24.26.34       40A6B78A9811 file       IP     -
2:4:3      peer   offline                -       40A6B78A9812 free       IP     -
2:4:4      peer   offline                -       40A6B78A9813 free       IP     -
3:1:1 initiator     ready       16.1.14.93       946DAED6F4C0 disk     NVMe  DP-1
3:1:2 initiator     ready       16.1.15.93       946DAED6F4C1 disk     NVMe  DP-2
3:2:1 initiator     ready         16.1.8.4       946DAED6EFCE disk     NVMe  DP-1
3:2:2 initiator     ready         16.1.9.4       946DAED6EFCF disk     NVMe  DP-2
3:3:1    target     ready 2FF70002AC07F065   23310002AC07F065 host       FC     -
3:3:2    target loss_sync 2FF70002AC07F065   23320002AC07F065 free       FC     -
3:3:3    target loss_sync 2FF70002AC07F065   23330002AC07F065 free       FC     -
3:3:4    target loss_sync 2FF70002AC07F065   23340002AC07F065 free       FC     -
3:4:1    target     ready      20.34.16.34       40A6B78A9680 file       IP     -
3:4:2    target     ready      20.34.26.34       40A6B78A9681 file       IP     -
3:4:3      peer   offline                -       40A6B78A9682 free       IP     -
3:4:4      peer   offline                -       40A6B78A9683 free       IP     -
---------------------------------------------------------------------------------
   48
```

**PARSING FUNCTION (Enhanced - Token-Based with N:S:P Decomposition):**
```javascript
function parseShowPort(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    
    const result = {
        ports: [],
        total: null
    };
    
    let parsing = false;
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // Start parsing after header line
        if (line.includes("N:S:P") && line.includes("Mode") && line.includes("State")) {
            parsing = true;
            continue;
        }
        
        // Skip dashed separator lines
        if (/^-{10,}/.test(line)) continue;
        
        // Detect total line (e.g., "24" or "48")
        if (/^\d+$/.test(line)) {
            result.total = parseInt(line, 10);
            break;
        }
        
        if (!parsing) continue;
        
        const parts = line.split(/\s+/);
        if (parts.length < 7) continue;
        
        const port = {};
        
        // N:S:P parsing and decomposition
        port.nsp = parts[0];
        const nspParts = parts[0].split(':');
        if (nspParts.length === 3) {
            port.node = parseInt(nspParts[0], 10);
            port.slot = parseInt(nspParts[1], 10);
            port.port = parseInt(nspParts[2], 10);
        }
        
        port.mode = parts[1];
        port.state = parts[2];
        
        // Stable suffix fields (order from right to left)
        port.label = parts[parts.length - 1];
        port.protocol = parts[parts.length - 2];
        port.type = parts[parts.length - 3];
        port.port_wwn_hw = parts[parts.length - 4];
        port.node_wwn_ip = parts[3];
        
        result.ports.push(port);
    }
    
    return result;
}
```

**PARSED OUTPUT: (truncated)** 

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

**CLI O/P (Variant 1 - No switches):**
```
showswitch
No switches listed
```

**CLI O/P (Variant 2 - With switches):**
```
showswitch
Name State  Mode   LocateLED Serial     PS1 PS2 Fans Temp
sw1  Normal Online off       TW32KM3056 ok  ok  ok   normal
sw2  Normal Online off       TW32KM303T ok  ok  ok   normal
-----------------------------------------------------------
2    total
```

**PARSING FUNCTION:**
```javascript
function parseShowSwitch(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    
    const result = {
        switches: [],
        total: null,
        message: null
    };
    
    let parsing = false;
    let headerFound = false;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        
        // Check for "No switches listed" message
        if (line.includes("No switches listed")) {
            result.message = "No switches listed";
            return result;
        }
        
        // Detect header line
        if (line.includes("Name") && line.includes("State") && line.includes("Mode")) {
            headerFound = true;
            parsing = true;
            continue;
        }
        
        // Skip dashed separator lines
        if (/^-{10,}/.test(line)) continue;
        
        // Detect total line (e.g., "2    total")
        const totalMatch = line.match(/(\d+)\s*total/);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1], 10);
            parsing = false;
            break;
        }
        
        // Parse data rows
        if (parsing && headerFound) {
            // Split by whitespace (token-based)
            const parts = line.split(/\s+/);
            
            // Expected: [Name, State, Mode, LocateLED, Serial, PS1, PS2, Fans, Temp]
            if (parts.length >= 9) {
                const switchInfo = {
                    name: parts[0],
                    state: parts[1],
                    mode: parts[2],
                    locate_led: parts[3],
                    serial: parts[4],
                    ps1: parts[5],
                    ps2: parts[6],
                    fans: parts[7],
                    temp: parts[8]
                };
                result.switches.push(switchInfo);
            }
        }
    }
    
    return result;
}
```

**PARSED OUTPUT (Variant 1 - No switches):**
```json
{
  "switches": [],
  "total": null,
  "message": "No switches listed"
}
```

**PARSED OUTPUT (Variant 2 - With switches):**
```json
{
  "switches": [
    {
      "name": "sw1",
      "state": "Normal",
      "mode": "Online",
      "locate_led": "off",
      "serial": "TW32KM3056",
      "ps1": "ok",
      "ps2": "ok",
      "fans": "ok",
      "temp": "normal"
    },
    {
      "name": "sw2",
      "state": "Normal",
      "mode": "Online",
      "locate_led": "off",
      "serial": "TW32KM303T",
      "ps1": "ok",
      "ps2": "ok",
      "fans": "ok",
      "temp": "normal"
    }
  ],
  "total": 2,
  "message": null
}
```
## FOR SHOWHOST
**CLI O/P (Variant 1):**
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

**CLI O/P (Variant 2):**
```
showhost
Id Name  Persona -WWN/iSCSI_Name/NQN- Port
--               51402EC0181CFF12     3:3:1
                 51402EC0181CFF12     2:3:1
...
-------------------------------------------
58 total
```

**CLI O/P (Variant 3):**
```
showhost
Id Name            Persona      -WWN/iSCSI_Name/NQN- Port
                                1000AAAABBBB1001     0:3:1
                                1000AAAABBBB1002     1:3:1
                                1000AAAABBBB1003     1:3:1
                                1000AAAABBBB1003     0:3:1
                                1000AAAABBBB1004     ---
                                1000AAAABBBB1005     1:3:1
                                1000AAAABBBB1005     0:3:1
                                1000AAAABBBB1006     ---
                                1000AAAABBBB1007     0:3:1
                                1000AAAABBBB1008     1:3:1
--                              1000AAAABBBB1009     1:3:1
                                1000AAAABBBB1010     1:3:1
                                5140CCCCDDDD1001     1:3:1
                                1000AAAABBBB1011     1:3:1
                                1000AAAABBBB1012     1:3:1
                                1000AAAABBBB1013     1:3:1
                                1000AAAABBBB1009     0:3:1
                                5140CCCCDDDD1000     0:3:1
                                1000AAAABBBB1010     0:3:1
                                1000AAAABBBB1012     0:3:1
                                1000AAAABBBB1011     0:3:1
                                1000AAAABBBB1013     0:3:1
----------------------------------------------------------
22 total
```

**PARSING FUNCTION:**
```javascript
function parseShowHost(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    const result = { hosts: [], total: null };
    const wwnMap = new Map();
    let parsing = false;
    
    for (let line of lines) {
        if (line.includes("-WWN/iSCSI_Name/NQN-") && line.includes("Port")) {
            parsing = true;
            continue;
        }
        if (!parsing) continue;
        if (/^-{10,}/.test(line.trim())) continue;
        
        const totalMatch = line.match(/(\d+)\s*total/);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1], 10);
            break;
        }
        
        const wwnMatch = line.match(/([0-9A-Fa-f]{12,16})/);
        const portMatch = line.match(/(\d+:\d+:\d+|---)/);
        
        if (!wwnMatch) continue;
        
        const wwn = wwnMatch[1];
        const nsp = portMatch ? portMatch[1] : null;
        
        // Extract ID, Name, Persona from the text before the WWN
        let hostId = null, name = null, persona = null;
        const prefix = line.substring(0, wwnMatch.index).trim();
        
        if (prefix && prefix !== '--') {
            const parts = prefix.split(/\s+/);
            let idx = 0;
            if (parts[idx] === '--') idx++;
            if (idx < parts.length && /^\d+$/.test(parts[idx])) hostId = parseInt(parts[idx++], 10);
            if (idx < parts.length) name = parts[idx++];
            if (idx < parts.length) persona = parts[idx++];
        }
        
        if (!wwnMap.has(wwn)) {
            wwnMap.set(wwn, {
                wwn: wwn,
                host_id: hostId,
                name: name || `host-${wwn.substring(0, 8)}`, // fallback name if blank
                persona: persona,
                Port: []
            });
        } else if (name) {
            // Update name if we found it on a subsequent line (rare)
            wwnMap.get(wwn).name = name;
            if (hostId !== null) wwnMap.get(wwn).host_id = hostId;
            if (persona) wwnMap.get(wwn).persona = persona;
        }
        
        if (nsp && nsp !== "---") {
            const pParts = nsp.split(":");
            let portObj = { nsp: nsp };
            if (pParts.length === 3) {
                portObj.node = parseInt(pParts[0], 10);
                portObj.slot = parseInt(pParts[1], 10);
                portObj.port = parseInt(pParts[2], 10);
            }
            wwnMap.get(wwn).Port.push(portObj);
        }
    }
    
    for (const hostData of wwnMap.values()) {
        result.hosts.push(hostData);
    }
    
    return result;
}
```

**PARSED OUTPUT (Variant 1):**
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

**PARSED OUTPUT (Variant 2):**
```json
{
  "hosts": [
    {
      "wwn": "51402EC0181CFF12",
      "Port": [
        { "nsp": "3:3:1", "node": 3, "slot": 3, "port": 1 },
        { "nsp": "2:3:1", "node": 2, "slot": 3, "port": 1 },
        { "nsp": "1:3:1", "node": 1, "slot": 3, "port": 1 },
        { "nsp": "0:3:1", "node": 0, "slot": 3, "port": 1 }
      ]
    }
  ],
  "total": 58
}
```
**PARSED OUTPUT (Variant 3):**
```json
{
  "hosts": [
    {
      "wwn": "1000AAAABBBB1001",
      "Port": [
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1002",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1003",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1004",
      "Port": []
    },
    {
      "wwn": "1000AAAABBBB1005",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1006",
      "Port": []
    },
    {
      "wwn": "1000AAAABBBB1007",
      "Port": [
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1008",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1009",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1010",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "5140CCCCDDDD1001",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1011",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1012",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "1000AAAABBBB1013",
      "Port": [
        {
          "nsp": "1:3:1",
          "node": 1,
          "slot": 3,
          "port": 1
        },
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
    },
    {
      "wwn": "5140CCCCDDDD1000",
      "Port": [
        {
          "nsp": "0:3:1",
          "node": 0,
          "slot": 3,
          "port": 1
        }
      ]
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
    const lines = cliOutput.split(/\r?\n/);
    const result = { cages: [] };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Id") && line.includes("Name")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 7) continue;

        const id = parseInt(parts[0], 10);
        const name = parts[1];

        let drives = 0;
        let temp = "0";
        let model = "";
        let formFactor = "";
        let state = "";

        if (parts.length >= 9) {
            state = parts[2];
            drives = parseInt(parts[4], 10) || 0;
            temp = parts[5];
            model = parts[6];
            formFactor = parts[7];
        } else {
            drives = parseInt(parts[2], 10) || 0;
            temp = parts[3];
            formFactor = parts[parts.length - 2];
            state = parts[parts.length - 1];
            const modelParts = parts.slice(4, parts.length - 2);
            model = modelParts.join(" ");
        }

        result.cages.push({ id, name, drives, temp, model, form_factor: formFactor, state });
    }
    return result;
}
```

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

---

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
    const lines = cliOutput.split(/\r?\n/);
    const result = { cages: [], total: null };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Id") && line.includes("Name") && line.includes("State")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;

        const totalMatch = line.match(/(\d+)\s*total|total\s+(\d+)/i);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1] || totalMatch[2], 10);
            break;
        }
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 4) continue;

        const id = parseInt(parts[0], 10);
        const name = parts[1];

        let state = "";
        let detailedState = "";

        if (parts.length >= 8) {
            state = parts[2];
            detailedState = parts[2];
        } else {
            state = parts[parts.length - 2];
            detailedState = parts[parts.length - 1];
        }

        result.cages.push({ id, name, state, detailed_state: detailedState });
    }
    return result;
}
```

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

---

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
    const lines = cliOutput.split(/\r?\n/);
    const result = { slots: [], total: null };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Cage") && line.includes("IOM") && line.includes("Slot")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;

        const totalMatch = line.match(/(\d+)\s*total|total\s+(\d+)/i);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1] || totalMatch[2], 10);
            break;
        }
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;

        const cage = parseInt(parts[0], 10);
        const iom = parseInt(parts[1], 10);
        const slot = parseInt(parts[2], 10);
        const type = parts[3];
        const rev = parts[parts.length - 2];
        const firmware = parts[parts.length - 1];

        const middleParts = parts.slice(4, parts.length - 2);
        const manufacturer = middleParts[0] || "";
        const model = middleParts[1] || "";
        const serial = middleParts[middleParts.length - 1] || "";

        result.slots.push({ cage, iom, slot, type, manufacturer, model, serial, rev, firmware });
    }
    return result;
}
```

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

---

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
    const lines = cliOutput.split(/\r?\n/);
    const result = { sfps: [], total: null };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Cage") && line.includes("IOM") && line.includes("SFP") && line.includes("State")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;

        const totalMatch = line.match(/(\d+)\s*total|total\s+(\d+)/i);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1] || totalMatch[2], 10);
            break;
        }
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 10) continue;

        const sfp = {};
        sfp.cage = parseInt(parts[0], 10);
        sfp.iom = parseInt(parts[1], 10);
        sfp.sfp = parseInt(parts[2], 10);
        sfp.label = parts[3];

        sfp.state = parts[parts.length - 1];
        sfp.ddm = parts[parts.length - 2];
        sfp.rx_power_low = parts[parts.length - 3];
        sfp.rx_loss = parts[parts.length - 4];
        sfp.tx_fault = parts[parts.length - 5];
        sfp.tx_disable = parts[parts.length - 6];
        sfp.max_speed_gbps = parseFloat(parts[parts.length - 7]);
        sfp.qualified = parts[parts.length - 8];
        sfp.revision = parts[parts.length - 9];
        sfp.serial_number = parts[parts.length - 10];
        sfp.part_number = parts[parts.length - 11];

        const manufacturerParts = parts.slice(4, parts.length - 11);
        sfp.manufacturer = manufacturerParts.join(" ");

        result.sfps.push(sfp);
    }
    return result;
}
```

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
    const lines = cliOutput.split(/\r?\n/);
    const result = { drives: [], total: null, total_cap: null, free_cap: null };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Id") && line.includes("CagePos") && line.includes("Type")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;

        // Total line: "48 total                   703070208 56586240"
        const totalMatch = line.match(/(\d+)\s*total\s+(\d+)\s+(\d+)/i);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1], 10);
            result.total_cap = parseInt(totalMatch[2], 10);
            result.free_cap = parseInt(totalMatch[3], 10);
            break;
        }
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 8) continue;

        result.drives.push({
            id: parseInt(parts[0], 10),
            cage_pos: parts[1],
            type: parts[2],
            rpm: parts[3] === "N/A" ? null : parseInt(parts[3], 10),
            state: parts[4],
            total_mib: parseInt(parts[5], 10),
            free_mib: parseInt(parts[6], 10),
            capacity_gb: parseInt(parts[7], 10)
        });
    }
    return result;
}
```

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
---

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
    const lines = cliOutput.split(/\r?\n/);
    const result = { drives: [], total: null };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Id") && line.includes("CagePos") && line.includes("Type")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;

        const totalMatch = line.match(/(\d+)\s*total/i);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1], 10);
            break;
        }
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 6) continue;

        result.drives.push({
            id: parseInt(parts[0], 10),
            cage_pos: parts[1],
            type: parts[2],
            state: parts[3],
            detailed_state: parts[4],
            sed_state: parts[5]
        });
    }
    return result;
}
```

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

---

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
    const lines = cliOutput.split(/\r?\n/);
    const result = { drives: [], total: null };
    let parsing = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.includes("Id") && line.includes("CagePos") && line.includes("State")) {
            parsing = true;
            continue;
        }
        if (/^-{5,}/.test(line)) continue;

        const totalMatch = line.match(/(\d+)\s*total/i);
        if (totalMatch) {
            result.total = parseInt(totalMatch[1], 10);
            break;
        }
        if (!parsing) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 12) continue;  // enough tokens

        // Parse fixed prefix: Id, CagePos, State
        const id = parseInt(parts[0], 10);
        const cagePos = parts[1];
        const state = parts[2];

        // Admission time is the last 3 tokens (date, time, timezone)
        const admissionTime = parts.slice(-3).join(" ");
        // Remaining tokens from index 3 to end-3 are middle fields
        const middle = parts.slice(3, -3);

        // Known field order: Node_WWN, MFR, Model, Serial, FW_Rev, Protocol, Type
        // Model can be multiple words, so we need to find where Serial starts.
        // Serial typically starts with 'S' followed by alphanumeric (e.g., "S7PNNE0X400136")
        // We'll search for the first token that looks like a serial (starts with 'S' and has length > 8)
        let serialIndex = -1;
        for (let i = 0; i < middle.length; i++) {
            if (/^S[A-Z0-9]{8,}$/.test(middle[i])) {
                serialIndex = i;
                break;
            }
        }
        if (serialIndex === -1) continue;  // fallback, skip this row

        const nodeWwn = middle[0];
        const mfr = middle[1];
        const model = middle.slice(2, serialIndex).join(" ");
        const serial = middle[serialIndex];
        const fwRev = middle[serialIndex + 1];
        const protocol = middle[serialIndex + 2];
        const type = middle[serialIndex + 3];

        result.drives.push({
            id: id,
            cage_pos: cagePos,
            state: state,
            node_wwn: nodeWwn,
            manufacturer: mfr,
            model: model,
            serial: serial,
            firmware_rev: fwRev,
            protocol: protocol,
            drive_type: type,
            admission_time: admissionTime
        });
    }
    return result;
}
```
PARSER O/P:
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
    const lines = cliOutput.split(/\r?\n/);
    const result = { hosts: [], total: null };
    let parsing = false;
    let currentHost = null;
    for (let line of lines) {
        if (line.includes('-WWN/iSCSI_Name/NQN-') && line.includes('Port')) { parsing = true; continue; }
        if (!parsing) continue;
        if (/^-{10,}/.test(line.trim())) continue;
        const totalMatch = line.match(/(\d+)\s*total/);
        if (totalMatch) { result.total = parseInt(totalMatch[1], 10); break; }
        // Line with Id + Name (new host entry)
        const fullMatch = line.match(/^\s*(\d+|--)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
        if (fullMatch) {
            currentHost = { id: fullMatch[1] === '--' ? null : parseInt(fullMatch[1], 10), name: fullMatch[2], persona: fullMatch[3], wwns: [{ wwn: fullMatch[4], port: fullMatch[5] }] };
            result.hosts.push(currentHost);
            continue;
        }
        // Continuation line (WWN + Port only)
        const contMatch = line.match(/^\s+(\S{10,})\s+(\S+)\s*$/);
        if (contMatch && currentHost) {
            currentHost.wwns.push({ wwn: contMatch[1], port: contMatch[2] });
        }
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

**CLI O/P (excerpt):**
```
showportdev ns -nohdtot 0:3:1
0xc0200 0x00 0x00 2FF70000DUMMY001 20310000DUMMY001 0x8800 0x0012 n/a 0x0800 20310000DUMMY001 HPE Alletra Storage MP - DUMMY000999 - fw:105600   0:3:1
0xc1100 0x0a 0x00 2000AAAABBBB1001 1000AAAABBBB1001 0x0000 0x0000 0x0000 0x0000 20310000DUMMY001 Emulex SN1600E1P FV14.0.499.29 DV14.0.499.31 HN:host-lnx-222.example.local OS:Linux  host-lnx-222
0x641600 0x05 0x00 2000AAAABBBB1004 1000AAAABBBB1004 0x0000 0x0000 0x0000 0x0000 20310000DUMMY001 Emulex SN1200E2P FV14.4.473.14 DV14.4.0.40 HN:host-esx-131.example.local OS:VMware ESXi 8.0.3  -
```

**PARSING FUNCTION:**
```javascript
function parseShowPortDevNS(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    const result = { array_port: null, entries: [] };
    for (let line of lines) {
        if (!line.trim() || line.startsWith('showportdev')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;
        const descRaw = parts.slice(10).join(' ');
        // Skip array self-entries (no HN: field)
        if (!descRaw.includes('HN:')) {
            // Extract array port from last token if N:S:P pattern
            if (/^\d+:\d+:\d+$/.test(parts[parts.length - 1]) && !result.array_port) {
                result.array_port = parts[parts.length - 1];
            }
            continue;
        }
        const entry = {};
        entry.node_wwn = parts[3];
        entry.port_wwn = parts[4];
        // Parse HBA model, FW, DV from description
        const hnMatch = descRaw.match(/HN:(\S+)/);
        const osMatch = descRaw.match(/OS:(.+?)(?:\s{2,}|$)/);
        const fvMatch = descRaw.match(/FV([\d.]+)/);
        const dvMatch = descRaw.match(/DV([\d.]+)/);
        const modelMatch = descRaw.match(/^(Emulex \S+|SN\w+|Qlogic \S+)/);
        entry.hostname = hnMatch ? hnMatch[1] : null;
        entry.os = osMatch ? osMatch[1].trim() : null;
        entry.hba_fw = fvMatch ? fvMatch[1] : null;
        entry.hba_driver = dvMatch ? dvMatch[1] : null;
        entry.hba_model = modelMatch ? modelMatch[1] : null;
        const lastToken = parts[parts.length - 1];
        entry.path_active = lastToken !== '-';
        entry.connected_host = entry.path_active ? lastToken : null;
        result.entries.push(entry);
    }
    return result;
}
```

**PARSED OUTPUT (excerpt):**
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

## FOR SWITCHSHOW (Brocade FC Switch)

**PARSING FUNCTION:**
```javascript
function parseSwitchShow(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    const result = { info: {}, ports: [], port_summary: { online: 0, no_light: 0, e_ports: 0, f_ports: 0 } };
    let inPortTable = false;
    for (let line of lines) {
        if (line.startsWith('switchName:'))  { result.info.name = line.split(':')[1].trim(); continue; }
        if (line.startsWith('switchState:')) { result.info.state = line.split(':')[1].trim(); continue; }
        if (line.startsWith('switchRole:'))  { result.info.role = line.split(':')[1].trim(); continue; }
        if (line.startsWith('switchDomain:')){ result.info.domain = line.split(':')[1].trim(); continue; }
        if (line.startsWith('switchWwn:'))   { result.info.wwn = line.split(':').slice(1).join(':').trim(); continue; }
        if (line.startsWith('zoning:'))      { result.info.zoning = line.split(':')[1].trim(); continue; }
        if (line.startsWith('Fabric Name:')) { result.info.fabric_name = line.split(':')[1].trim(); continue; }
        if (line.includes('Index Port Address')) { inPortTable = true; continue; }
        if (!inPortTable) continue;
        if (/^={5,}/.test(line.trim())) continue;
        const portMatch = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)/);
        if (portMatch) {
            const state = portMatch[4];
            const isEPort = line.includes('E-Port');
            const isFPort = line.includes('F-Port');
            const port = { index: parseInt(portMatch[1]), port: parseInt(portMatch[2]), address: portMatch[3], state };
            if (isEPort) { port.type = 'E-Port'; result.port_summary.e_ports++; }
            else if (isFPort) { port.type = 'F-Port'; result.port_summary.f_ports++; }
            if (state === 'Online') result.port_summary.online++;
            else if (state === 'No_Light') result.port_summary.no_light++;
            result.ports.push(port);
        }
    }
    return result;
}
```

## FOR SYSTOOL -C FC_HOST (Linux HBA FC Info)

**PARSING FUNCTION:**
```javascript
function parseSystoolFCHost(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    const result = { hbas: [] };
    let current = null;
    for (let line of lines) {
        const devMatch = line.match(/Class Device\s*=\s*"(host\d+)"/);
        if (devMatch) { current = { host_id: devMatch[1], port_name: null, port_state: null, speed: null, supported_speeds: null }; result.hbas.push(current); continue; }
        if (!current) continue;
        const pnMatch = line.match(/port_name\s*=\s*"?(0x[\da-fA-F]+)"?/);
        if (pnMatch) { current.port_name = pnMatch[1]; continue; }
        const psMatch = line.match(/port_state\s*=\s*"?(\S+)"?/);
        if (psMatch) { current.port_state = psMatch[1]; continue; }
        const spMatch = line.match(/^\s+speed\s*=\s*"?(.+?)"?\s*$/);
        if (spMatch) { current.speed = spMatch[1].trim(); continue; }
        const ssMatch = line.match(/supported_speeds\s*=\s*"?(.+?)"?\s*$/);
        if (ssMatch) { current.supported_speeds = ssMatch[1].trim(); }
    }
    return result;
}
```

## FOR LSPCI (Linux FC PCI Adapters)

**PARSING FUNCTION:**
```javascript
function parseLspciFC(cliOutput) {
    const lines = cliOutput.split(/\r?\n/);
    const result = { adapters: [] };
    let current = null;
    for (let line of lines) {
        // New PCI device line
        const devMatch = line.match(/^([\da-f:]+\.\d)\s+Fibre Channel/i);
        if (devMatch) { current = { pci_slot: devMatch[1], description: line.trim(), subsystem: null, driver: null, modules: null }; result.adapters.push(current); continue; }
        if (!current) continue;
        const subMatch = line.match(/Subsystem:\s*(.+)/);
        if (subMatch) { current.subsystem = subMatch[1].trim(); continue; }
        const drvMatch = line.match(/Kernel driver in use:\s*(\S+)/);
        if (drvMatch) { current.driver = drvMatch[1]; continue; }
        const modMatch = line.match(/Kernel modules:\s*(.+)/);
        if (modMatch) { current.modules = modMatch[1].trim(); continue; }
        // Non-FC line resets current
        if (/^\S/.test(line) && !line.includes('Fibre Channel')) current = null;
    }
    return result;
}
```

**PARSED OUTPUT:**
```json
{
  "adapters": [
    { "pci_slot": "0a:00.0", "subsystem": "Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]", "driver": "lpfc", "modules": "lpfc" },
    { "pci_slot": "0a:00.1", "subsystem": "Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]", "driver": "lpfc", "modules": "lpfc" }
  ]
}
```