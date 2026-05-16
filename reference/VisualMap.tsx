"use client";
import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType,
  getNodesBounds,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as htmlToImage from "html-to-image";
import { TopologyGraph } from "../lib/mockData";

// Add a custom node style
const customNodeStyle = {
  background: 'var(--surface-1)',
  color: 'var(--foreground)',
  border: '1px solid var(--line-strong)',
  borderRadius: '8px',
  padding: '10px 15px',
  fontSize: '12px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  minWidth: '150px',
  fontFamily: 'system-ui, sans-serif'
};

const getStatusColor = (status: string) => {
  if (status === 'normal') return '#10b981'; // emerald-500
  if (status === 'degraded') return '#f59e0b'; // amber-500
  return '#f43f5e'; // rose-500
};

interface VisualMapProps {
  data: TopologyGraph;
  onClose: () => void;
}

export default function VisualMap({ data, onClose }: VisualMapProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Auto-layout simple algorithm: 
  // Hosts Y=0, Switches Y=150, Arrays Y=300
  // X=spacing based on index in tier
  const hostNodes = data.nodes.filter(n => n.type === 'Host');
  const switchNodes = data.nodes.filter(n => n.type === 'Switch');
  const arrayNodes = data.nodes.filter(n => n.type === 'Array');
  // Anything else goes into 'other' at the bottom
  const otherNodes = data.nodes.filter(n =>
    n.type !== 'Host' &&
    n.type !== 'Switch' && n.type !== 'Array'
  );

  const initialNodes: any[] = [];

  const layoutTier = (tierNodes: any[], startY: number) => {
    const spacingX = 400; // Increased spacing to give ample breathing room
    const totalWidth = (tierNodes.length - 1) * spacingX;
    const startX = -(totalWidth / 2);

    tierNodes.forEach((node, idx) => {
      initialNodes.push({
        id: node.id,
        position: { x: startX + (idx * spacingX), y: startY },
        data: {
          label: (
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-1.5 mb-1">
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: getStatusColor(node.status) }} />
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{node.type}</span>
              </div>
              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px', fontSize: '13px' }}>{node.name}</strong>
              <span style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>{node.id}</span>
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
  const parentGroups: Record<string, any[]> = {};

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
              <div className="flex flex-col text-left">
                <div className="flex items-center gap-1.5 mb-1">
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getStatusColor(child.status) }} />
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--muted)' }}>{child.type}</span>
                </div>
                <strong style={{ fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{child.name}</strong>
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
              <div className="flex flex-col text-left">
                <div className="flex items-center gap-1.5 mb-1">
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getStatusColor(child.status) }} />
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--muted)' }}>{child.type}</span>
                </div>
                <strong style={{ fontSize: '12px' }}>{child.name}</strong>
              </div>
            )
          },
          style: { ...customNodeStyle, padding: '8px 12px', minWidth: '140px' },
        });
        drawnIds.add(child.id);
      });
    }
  });

  const initialEdges = data.edges.map(e => ({
    id: `e-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label,
    animated: true,
    style: { stroke: '#3b82f6', strokeWidth: 2, opacity: 0.7 },
    labelStyle: { fill: '#a3a3a3', fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#171717' },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#3b82f6',
    },
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as any);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as any);

  const downloadImage = useCallback(() => {
    // The viewport element inside react flow wrapper
    const el = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!el) return;

    // Calculate the bounding box of all nodes
    const bounds = getNodesBounds(nodes);
    const padding = 100;
    const imageWidth = bounds.width + padding * 2;
    const imageHeight = bounds.height + padding * 2;

    htmlToImage.toPng(el, {
      backgroundColor: '#aeaeae',
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

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--background)] bg-opacity-95 backdrop-blur-xl animate-fadeIn">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)] bg-[var(--surface-1)]">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]" style={{ fontFamily: "var(--font-playfair-display)" }}>
            Visual SAN Topology Map
          </h2>
          <p className="text-xs text-[var(--muted)]">Interactive node-link graph visualization</p>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </header>

      <div className="flex-1 relative w-full h-full" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          attributionPosition="bottom-right"
          minZoom={0.1}
          colorMode="dark"
        >
          <Background color="var(--line-strong)" gap={20} size={1} />
          <Controls className="!bg-[var(--surface-1)] !border-[var(--line)] !fill-[var(--muted)]" />

          <Panel position="top-right" className="flex gap-2">
            <button
              onClick={downloadImage}
              className="toolbar-btn primary shadow-xl h-10 px-4"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download PNG Image
            </button>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
