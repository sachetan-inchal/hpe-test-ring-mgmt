import { useCallback, useEffect, useMemo, useRef } from "react";
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

import dagre from 'dagre';

function hexToRgb(hex) {
  if (!hex || hex.length < 7) return '139, 148, 158';
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

const getTypeMeta = (type) => {
  const t = type || 'Unknown';
  if (t === 'Array' || t === 'ArraySystem') return { color: '#58a6ff', yTier: 100, icon: '📦' };
  if (t === 'Switch') return { color: '#bc8cff', yTier: 300, icon: '🔁' };
  if (t === 'Host') return { color: '#3fb950', yTier: 500, icon: '🖥️' };
  return { color: '#8b949e', yTier: 700, icon: '⚙️' };
};

const getStatusColor = (status) => {
  if (status === 'normal') return 'var(--status-ok)';
  if (status === 'degraded') return 'var(--status-warn)';
  return 'var(--status-critical)';
};

export default function TopologyCanvas({ data, nodes: legacyNodes, edges: legacyEdges, onClose, onNodeClick, isSidebar = false }) {
  const reactFlowWrapper = useRef(null);

  const { nodes: rawNodes = [], edges: rawEdges = [] } = data || { nodes: legacyNodes || [], edges: legacyEdges || [] };

  const { initialNodes, initialEdges } = useMemo(() => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    
    // Config: TB means top-to-bottom
    const nodeWidth = 220;
    const nodeHeight = 80;
    dagreGraph.setGraph({ rankdir: 'TB', ranksep: 120, nodesep: 80 });

    rawNodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    rawEdges.forEach((edge) => {
      const src = edge.from || edge.source;
      const tgt = edge.to || edge.target;
      if (src && tgt) {
        dagreGraph.setEdge(src, tgt);
      }
    });

    dagre.layout(dagreGraph);

    const laidNodes = rawNodes.map((n) => {
      const nodeWithPosition = dagreGraph.node(n.id);
      const meta = getTypeMeta(n.type);
      const x = nodeWithPosition && !isNaN(nodeWithPosition.x) ? nodeWithPosition.x - nodeWidth / 2 : Math.random() * 500;
      const y = nodeWithPosition && !isNaN(nodeWithPosition.y) ? nodeWithPosition.y - nodeHeight / 2 : meta.yTier;
      
      const isSelected = false;
      const isPulsing = false;
      const isHighlighted = false;

      return {
        id: n.id,
        position: { x, y },
        data: {
          label: (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: meta.color,
                }}>{n.type}</span>
              </div>
              <strong style={{ fontSize: 13, color: '#e6edf3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }} title={n.name || n.id}>{n.name || n.id}</strong>
              <span style={{ fontSize: 10, color: '#8b949e', fontFamily: 'JetBrains Mono, monospace' }} title={n.id}>{n.id}</span>
              {n.model && <span style={{ fontSize: 9, color: '#8b949e' }}>{n.model}</span>}
            </div>
          )
        },
        style: {
          background: isSelected ? `rgba(${hexToRgb(meta.color)}, 0.2)` : '#161b22',
          border: `1.5px solid ${isSelected ? meta.color : isHighlighted || isPulsing ? meta.color : '#30363d'}`,
          borderRadius: 10,
          padding: '12px 16px',
          fontSize: 12,
          color: '#e6edf3',
          minWidth: 200,
          boxShadow: isPulsing
            ? `0 0 0 4px rgba(${hexToRgb(meta.color)}, 0.55), 0 0 24px rgba(${hexToRgb(meta.color)}, 0.35)`
            : isHighlighted
              ? `0 0 0 3px rgba(${hexToRgb(meta.color)}, 0.4), 0 0 20px rgba(${hexToRgb(meta.color)}, 0.2)`
              : isSelected ? `0 0 0 2px ${meta.color}` : '0 2px 8px rgba(0,0,0,0.4)',
          transition: 'all 0.3s ease',
        }
      };
    });

    const laidEdges = rawEdges.map(e => ({
      id: e.id || `e-${e.from || e.source}-${e.to || e.target}`,
      source: e.from || e.source,
      target: e.to || e.target,
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

    return { initialNodes: laidNodes, initialEdges: laidEdges };
  }, [rawNodes, rawEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update react flow internal state when the useMemo initialNodes change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

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
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--line)',
              width: isSidebar ? 60 : 120,
              height: isSidebar ? 45 : 90,
              margin: 4
            }}
            position="bottom-right"
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
