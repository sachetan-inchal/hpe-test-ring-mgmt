import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType,
  getNodesBounds,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as htmlToImage from "html-to-image";

// Custom node style inspired by reference VisualMap
const customNodeStyle = {
  background: 'var(--surface-1)',
  color: 'var(--foreground)',
  border: '1px solid var(--line-strong)',
  borderRadius: '8px',
  padding: '10px 15px',
  fontSize: '12px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  minWidth: '150px',
  fontFamily: 'var(--font-sans)'
};

const getStatusColor = (status) => {
  if (status === 'normal') return 'var(--status-ok)';
  if (status === 'degraded') return 'var(--status-warn)';
  return 'var(--status-critical)';
};

export default function TopologyCanvas({ data, onClose, onNodeClick }) {
  const reactFlowWrapper = useRef(null);

  const { nodes: rawNodes = [], edges: rawEdges = [] } = data || {};

  // Auto-layout simple algorithm from reference: 
  // Hosts Y=50, Switches Y=350, Arrays Y=700
  // X=spacing based on index in tier
  const hostNodes = rawNodes.filter(n => n.type === 'Host');
  const switchNodes = rawNodes.filter(n => n.type === 'Switch');
  const arrayNodes = rawNodes.filter(n => n.type === 'Array');
  // Anything else goes into 'other' at the bottom
  const otherNodes = rawNodes.filter(n =>
    n.type !== 'Host' &&
    n.type !== 'Switch' && n.type !== 'Array'
  );

  const initialNodes = [];

  const layoutTier = (tierNodes, startY) => {
    const spacingX = 400; // Increased spacing to give ample breathing room
    const totalWidth = (tierNodes.length - 1) * spacingX;
    const startX = -(totalWidth / 2);

    tierNodes.forEach((node, idx) => {
      initialNodes.push({
        id: node.id,
        position: { x: startX + (idx * spacingX), y: startY },
        data: {
          label: (
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: getStatusColor(node.status) }} />
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{node.type}</span>
              </div>
              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px', fontSize: 13 }}>{node.name}</strong>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{node.id}</span>
            </div>
          )
        },
        style: customNodeStyle,
      });
    });
  };

  layoutTier(hostNodes, 50);
  layoutTier(switchNodes, 350); // Increased vertical spacing
  layoutTier(arrayNodes, 700); // Increased vertical spacing

  // Arrange other sub-components under their parents
  const drawnIds = new Set(initialNodes.map(n => n.id));
  const parentGroups = {};

  otherNodes.forEach(n => {
    const pid = n.parentId || 'orphan';
    if (!parentGroups[pid]) parentGroups[pid] = [];
    parentGroups[pid].push(n);
  });

  let orphanIdx = 0;

  Object.keys(parentGroups).forEach(parentId => {
    const children = parentGroups[parentId];

    if (parentId !== 'orphan' && drawnIds.has(parentId)) {
      const parentNode = initialNodes.find(n => n.id === parentId);
      if (!parentNode) return;

      const cols = Math.min(children.length, 4); // Grid layout, up to 4 cols
      const spacingX = 180;
      const spacingY = 90;
      const startX = parentNode.position.x - ((cols - 1) * spacingX) / 2;
      const startY = parentNode.position.y + 140; // Push down nicely under parent

      children.forEach((child, idx) => {
        if (drawnIds.has(child.id)) return;
        const row = Math.floor(idx / cols);
        const col = idx % cols;

        initialNodes.push({
          id: child.id,
          position: { x: startX + (col * spacingX), y: startY + (row * spacingY) },
          data: {
            label: (
              <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getStatusColor(child.status) }} />
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--muted)' }}>{child.type}</span>
                </div>
                <strong style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{child.name}</strong>
              </div>
            )
          },
          style: { ...customNodeStyle, padding: '8px 12px', minWidth: '140px' },
        });
        drawnIds.add(child.id);
      });
    } else {
      // Orphans
      children.forEach(child => {
        if (drawnIds.has(child.id)) return;
        const x = (orphanIdx * 250) - ((children.length - 1) * 125);
        const y = 950; // Throw at the very bottom
        orphanIdx++;

        initialNodes.push({
          id: child.id,
          position: { x, y },
          data: {
            label: (
              <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getStatusColor(child.status) }} />
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--muted)' }}>{child.type}</span>
                </div>
                <strong style={{ fontSize: 12 }}>{child.name}</strong>
              </div>
            )
          },
          style: { ...customNodeStyle, padding: '8px 12px', minWidth: '140px' },
        });
        drawnIds.add(child.id);
      });
    }
  });

  const initialEdges = rawEdges.map(e => ({
    id: e.id || `e-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label,
    animated: true,
    style: { stroke: 'var(--accent-blue)', strokeWidth: 2, opacity: 0.7 },
    labelStyle: { fill: 'var(--muted)', fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: 'var(--surface-1)' },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: 'var(--accent-blue)',
    },
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const downloadImage = useCallback(() => {
    // The viewport element inside react flow wrapper
    const el = document.querySelector('.react-flow__viewport');
    if (!el) return;

    // Calculate the bounding box of all nodes
    const bounds = getNodesBounds(nodes);
    const padding = 100;
    const imageWidth = bounds.width + padding * 2;
    const imageHeight = bounds.height + padding * 2;

    htmlToImage.toPng(el, {
      backgroundColor: '#0d1117', // Match var(--background)
      width: imageWidth,
      height: imageHeight,
      style: {
        width: String(imageWidth),
        height: String(imageHeight),
        transform: `translate(${-bounds.x + padding}px, ${-bounds.y + padding}px) scale(1)`,
      }
    }).then((dataUrl) => {
      const link = document.createElement('a');
      link.download = `san-visual-diagram-${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      link.click();
    }).catch((err) => {
      console.error('Failed to export image', err);
      alert('Failed to generate image. See console for details.');
    });
  }, [nodes]);

  const handleNodeClick = useCallback((_, rfNode) => {
    if (onNodeClick) onNodeClick(rfNode.id);
  }, [onNodeClick]);

  const miniMapColor = useCallback((n) => {
    const rawMatch = rawNodes.find(x => x.id === n.id);
    if (!rawMatch) return 'var(--line-strong)';
    if (rawMatch.type === 'Array') return 'var(--color-array)';
    if (rawMatch.type === 'Switch') return 'var(--color-switch)';
    if (rawMatch.type === 'Host') return 'var(--color-host)';
    return 'var(--line-strong)';
  }, [rawNodes]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {onClose && (
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'var(--surface-1)' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--foreground)' }}>
              Visual SAN Topology Map
            </h2>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>Interactive node-link graph visualization</p>
          </div>
          <button
            onClick={onClose}
            style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </header>
      )}

      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }} ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          fitView
          attributionPosition="bottom-right"
          minZoom={0.1}
          colorMode="dark"
        >
          <Background color="var(--line-strong)" gap={20} size={1} />
          <Controls className="!bg-[var(--surface-1)] !border-[var(--line)] !fill-[var(--muted)]" />

          <MiniMap
            nodeColor={miniMapColor}
            maskColor="rgba(13, 17, 23, 0.7)"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--line)' }}
          />

          <Panel position="top-right" style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={downloadImage}
              className="btn btn-primary shadow-xl"
              style={{ height: 40, padding: '0 16px' }}
            >
              <svg style={{ marginRight: 6 }} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download PNG Image
            </button>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
