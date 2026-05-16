"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { TopologyGraph, TopologyNode } from "../lib/mockData";

interface SANDiagramProps {
  data: TopologyGraph;
  focusedId: string | null;
  expandedIds: string[];
  onNodeClick: (id: string, toggleExpand?: boolean) => void;
  selectedIds?: Set<string>;
  onSelectToggle?: (id: string, isSelected: boolean) => void;
}

export default function SANDiagram({ data, focusedId, expandedIds, onNodeClick, selectedIds, onSelectToggle }: SANDiagramProps) {
  const { nodes, edges } = data;

  const [colWidths, setColWidths] = useState<[number, number, number]>([350, 350, 350]);
  const [showArrays, setShowArrays] = useState(true);
  const [showSwitches, setShowSwitches] = useState(true);
  const [showHosts, setShowHosts] = useState(true);
  const dragState = useRef({ isDragging: -1, startX: 0, startWidth: 0 });

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (dragState.current.isDragging === -1) return;
      const { isDragging, startX, startWidth } = dragState.current;
      const delta = e.clientX - startX;
      setColWidths(prev => {
        const next = [...prev] as [number, number, number];
        next[isDragging] = Math.max(200, startWidth + delta);
        return next;
      });
    };
    const handleUp = () => {
      if (dragState.current.isDragging !== -1) {
        document.body.style.cursor = "";
      }
      dragState.current.isDragging = -1;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    dragState.current = {
      isDragging: index,
      startX: e.clientX,
      startWidth: colWidths[index]
    };
    document.body.style.cursor = "col-resize";
  };

  // Filter out decommissioned from standard view
  const activeNodes = useMemo(() => nodes.filter(n => !n.isDecommissioned), [nodes]);

  const arrays = activeNodes.filter(n => n.category === "main" && n.type === "Array");
  const switches = activeNodes.filter(n => n.category === "main" && n.type === "Switch");
  const hosts = activeNodes.filter(n => n.category === "main" && n.type === "Host");

  // Helper to get sub-components for a parent
  const getSubNodes = (parentId: string) => activeNodes.filter(n => n.parentId === parentId);
  const getConnectedEdges = (nodeId: string) => edges.filter(e => e.from === nodeId || e.to === nodeId);
  
  // Is this node part of the focused component path?
  const isHighlighted = (id: string) => {
    if (!focusedId) return false;
    if (focusedId === id) return true;
    const paths = getConnectedEdges(focusedId);
    return paths.some(p => p.from === id || p.to === id);
  };

  const renderCard = (node: TopologyNode, isSub: boolean = false) => {
    const isExpanded = expandedIds.includes(node.id);
    const focused = focusedId === node.id;
    const highlight = isHighlighted(node.id);
    const subs = getSubNodes(node.id);
    
    // Group sub-components by type for cleaner display inside parent
    const subsByType = subs.reduce((acc, sub) => {
      if (!acc[sub.type]) acc[sub.type] = [];
      acc[sub.type].push(sub);
      return acc;
    }, {} as Record<string, TopologyNode[]>);

    return (
      <div key={node.id} className="relative w-full mb-6">
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onNodeClick(node.id, false);
          }}
          className={`san-node relative z-10 w-full cursor-pointer border p-4 ${
            focused ? "focused" : highlight ? "expanded" : ""
          } ${isSub ? "rounded-md bg-[var(--surface-1)] p-3 text-sm hover:bg-[var(--surface-2)]" : "rounded-xl"} 
            transition-all duration-300
          `}
        >
          <div 
            className="flex items-start justify-between cursor-pointer"
            onClick={() => onNodeClick(node.id)}
          >
            <div className="flex items-start gap-3">
              {selectedIds && onSelectToggle && (
                <div className="mt-1" onClick={e => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    className="accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer"
                    checked={selectedIds.has(node.id)}
                    onChange={(e) => onSelectToggle(node.id, e.target.checked)}
                  />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${node.status === 'normal' ? 'bg-emerald-500' : node.status === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{node.type}</span>
                </div>
                <h3 className={`truncate font-semibold text-[var(--foreground)] ${isSub ? "text-sm" : "text-base"}`} title={node.name}>{node.name}</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{node.id}</p>
              </div>
            </div>
            
            {subs.length > 0 && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeClick(node.id, true);
                }}
                className="mt-1 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface-1)] text-[var(--muted)] transition hover:bg-[var(--surface-2)]"
              >
                <svg className={`h-4 w-4 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-[var(--accent-blue)]' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Main card extra details */}
          {!isSub && (
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--muted)]">
              {node.protocol && <span className="rounded border border-[var(--line)] bg-[var(--surface-1)] px-2 py-0.5">{node.protocol}</span>}
              {node.model && <span className="rounded border border-[var(--line)] bg-[var(--surface-1)] px-2 py-0.5">{node.model}</span>}
            </div>
          )}
        </div>

        {/* Sub-components container */}
        {isExpanded && subs.length > 0 && (
          <div className="relative ml-4 mt-1 space-y-4 border-l-2 border-[var(--line)] px-3 pb-2 pt-4 animate-fadeIn">
            {Object.entries(subsByType).map(([type, nodesOfType]) => (
              <div key={type} className="relative">
                <div className="mb-2 pl-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  <span className="absolute -left-[18px] top-[6px] h-[2px] w-3 bg-[var(--line)]"></span>
                  {type}s ({nodesOfType.length})
                </div>
                <div className="grid grid-cols-1 gap-2 pl-2">
                  {nodesOfType.map(subNode => renderCard(subNode, true))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative h-auto md:h-full w-full overflow-auto px-2 py-4">

      <div 
        className="san-columns flex h-auto md:h-full flex-col items-center gap-2 px-4 md:min-w-[900px] md:flex-row md:items-start md:gap-8"
        style={{ '--col-w-0': `${colWidths[0]}px`, '--col-w-1': `${colWidths[1]}px`, '--col-w-2': `${colWidths[2]}px` } as React.CSSProperties}
      >
        
        {/* Column 1: Arrays */}
        <div 
           className="flex w-full flex-col items-center px-2 md:w-[var(--col-w-0)] md:shrink-0"
        >
          <div 
            onClick={() => setShowArrays(!showArrays)}
            className="mb-2 flex w-full items-center justify-between gap-2 border-b border-[var(--line)] pb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)] transition-colors"
          >
             <div className="flex items-center gap-2">
               <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" /></svg>
               Storage Arrays
             </div>
             <svg className={`w-4 h-4 transition-transform md:hidden ${showArrays ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
          {showArrays && arrays.map(node => renderCard(node))}
        </div>

        {/* Visual Line Connectors Helper - Now a drag handle */}
          <div 
            onPointerDown={(e) => handlePointerDown(0, e)}
            className="mt-20 hidden h-full w-10 cursor-col-resize flex-col items-center justify-center opacity-40 transition-all hover:bg-[var(--accent-blue)]/10 hover:opacity-100 md:flex rounded-lg mx-2"
            title="Drag to resize Storage Arrays column"
          >
            <div className="h-[60%] w-px bg-gradient-to-b from-transparent via-[var(--accent-blue)] to-transparent pointer-events-none"></div>
            <svg className="my-2 h-6 w-6 rotate-90 text-[var(--accent-blue)] pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
            <div className="h-[60%] w-px bg-gradient-to-b from-transparent via-[var(--accent-blue)] to-transparent pointer-events-none"></div>
        </div>

        {/* Column 2: Switches */}
        <div 
           className="flex w-full flex-col items-center px-2 md:w-[var(--col-w-1)] md:shrink-0"
        >
          <div 
            onClick={() => setShowSwitches(!showSwitches)}
            className="mb-2 flex w-full items-center justify-between gap-2 border-b border-[var(--line)] pb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)] transition-colors"
          >
             <div className="flex items-center gap-2">
               <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
               Fabric Switches
             </div>
             <svg className={`w-4 h-4 transition-transform md:hidden ${showSwitches ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
          {showSwitches && switches.map(node => renderCard(node))}
        </div>

        {/* Visual Line Connectors Helper - Now a drag handle */}
          <div 
            onPointerDown={(e) => handlePointerDown(1, e)}
            className="mt-20 hidden h-full w-10 cursor-col-resize flex-col items-center justify-center opacity-40 transition-all hover:bg-[var(--accent-blue)]/10 hover:opacity-100 md:flex rounded-lg mx-2"
            title="Drag to resize Fabric Switches column"
          >
            <div className="h-[60%] w-px bg-gradient-to-b from-transparent via-[var(--accent-blue)] to-transparent pointer-events-none"></div>
            <svg className="my-2 h-6 w-6 rotate-90 text-[var(--accent-blue)] pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
            <div className="h-[60%] w-px bg-gradient-to-b from-transparent via-[var(--accent-blue)] to-transparent pointer-events-none"></div>
        </div>

        {/* Column 3: Hosts */}
        <div 
           className="flex w-full flex-col items-center px-2 md:w-[var(--col-w-2)] md:shrink-0"
        >
          <div 
            onClick={() => setShowHosts(!showHosts)}
            className="mb-2 flex w-full items-center justify-between gap-2 border-b border-[var(--line)] pb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)] transition-colors"
          >
             <div className="flex items-center gap-2">
               <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" /></svg>
               Compute Hosts
             </div>
             <svg className={`w-4 h-4 transition-transform md:hidden ${showHosts ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </div>
          {showHosts && hosts.map(node => renderCard(node))}
        </div>

      </div>
    </div>
  );
}
