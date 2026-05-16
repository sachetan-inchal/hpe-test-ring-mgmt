"use client";

import { useMemo, useRef, useState } from "react";
import { TopologyEdge, TopologyNode } from "../lib/mockData";

type Position = { x: number; y: number };

interface HierarchyTreeProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  visibleIds: string[];
  expandedIds: string[];
  highlightedIds: string[];
  pathIds: string[];
  focusedId: string | null;
  rootIds: string[];
  onNodeClick: (id: string) => void;
}

const cardWidth = 190;
const compactCardHeight = 90;
const expandedCardHeight = 156;
const focusedBump = 14;
const horizontalGap = 68;
const verticalGap = 24;
const canvasPadding = 32;

const statusClass: Record<string, string> = {
  normal: "border-emerald-700/60 bg-emerald-50/60",
  degraded: "border-amber-700/60 bg-amber-50/60",
  failed: "border-rose-700/60 bg-rose-50/60",
};

const edgePalette = ["#0284c7", "#16a34a", "#dc2626", "#7c3aed", "#ea580c", "#0f766e"];

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export default function HierarchyTree({
  nodes,
  edges,
  visibleIds,
  expandedIds,
  highlightedIds,
  pathIds,
  focusedId,
  rootIds,
  onNodeClick,
}: HierarchyTreeProps) {
  const [manualPositions, setManualPositions] = useState<Record<string, Position>>({});
  const movedDuringDrag = useRef(false);

  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const expandedSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const highlightedSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => visibleIdSet.has(node.id)),
    [nodes, visibleIdSet]
  );

  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of visibleNodes) {
      map.set(node.id, []);
    }
    for (const edge of edges) {
      if (!visibleIdSet.has(edge.from) || !visibleIdSet.has(edge.to)) {
        continue;
      }
      map.get(edge.from)?.push(edge.to);
      map.get(edge.to)?.push(edge.from);
    }
    return map;
  }, [edges, visibleNodes, visibleIdSet]);

  const cardHeights = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of visibleNodes) {
      const isExpanded = expandedSet.has(node.id);
      const isFocused = focusedId === node.id;
      map.set(
        node.id,
        (isExpanded ? expandedCardHeight : compactCardHeight) + (isFocused ? focusedBump : 0)
      );
    }
    return map;
  }, [expandedSet, focusedId, visibleNodes]);

  const positions = useMemo(() => {
    const depthMap = new Map<string, number>();
    const queue: string[] = [];

    for (const rootId of rootIds) {
      if (visibleIdSet.has(rootId)) {
        depthMap.set(rootId, 0);
        queue.push(rootId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      const nextDepth = (depthMap.get(current) ?? 0) + 1;
      for (const next of adjacency.get(current) ?? []) {
        if (!depthMap.has(next)) {
          depthMap.set(next, nextDepth);
          queue.push(next);
        }
      }
    }

    let overflowDepth = Math.max(0, ...Array.from(depthMap.values())) + 1;
    for (const node of visibleNodes) {
      if (!depthMap.has(node.id)) {
        depthMap.set(node.id, overflowDepth);
        overflowDepth += 1;
      }
    }

    const byDepth = new Map<number, string[]>();
    for (const node of visibleNodes) {
      const depth = depthMap.get(node.id) ?? 0;
      const bucket = byDepth.get(depth) ?? [];
      bucket.push(node.id);
      byDepth.set(depth, bucket);
    }

    const result = new Map<string, Position>();
    for (const [depth, ids] of byDepth.entries()) {
      ids.sort((a, b) => a.localeCompare(b));
      let yCursor = canvasPadding;
      ids.forEach((id) => {
        const height = cardHeights.get(id) ?? compactCardHeight;
        const extraGap = expandedSet.has(id) ? 14 : 0;
        result.set(id, {
          x: canvasPadding + depth * (cardWidth + horizontalGap),
          y: yCursor,
        });
        yCursor += height + verticalGap + extraGap;
      });
    }

    return result;
  }, [adjacency, cardHeights, expandedSet, rootIds, visibleIdSet, visibleNodes]);

  const finalPositions = useMemo(() => {
    const merged = new Map<string, Position>();
    for (const node of visibleNodes) {
      const fallback = positions.get(node.id);
      if (!fallback) {
        continue;
      }
      merged.set(node.id, manualPositions[node.id] ?? fallback);
    }
    return merged;
  }, [manualPositions, positions, visibleNodes]);

  const pathEdgeSet = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < pathIds.length - 1; i += 1) {
      set.add(edgeKey(pathIds[i], pathIds[i + 1]));
    }
    return set;
  }, [pathIds]);

  const maxY = useMemo(() => {
    let value = 360;
    for (const node of visibleNodes) {
      const pos = finalPositions.get(node.id);
      if (!pos) {
        continue;
      }
      const height = cardHeights.get(node.id) ?? compactCardHeight;
      value = Math.max(value, pos.y + height + canvasPadding);
    }
    return value;
  }, [cardHeights, finalPositions, visibleNodes]);

  const handleDragStart = (
    nodeId: string,
    event: React.PointerEvent<HTMLButtonElement>,
    origin: Position
  ) => {
    if (event.button !== 0) {
      return;
    }

    movedDuringDrag.current = false;
    const startX = event.clientX;
    const startY = event.clientY;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) {
        movedDuringDrag.current = true;
      }

      setManualPositions((prev) => ({
        ...prev,
        [nodeId]: {
          x: Math.max(6, origin.x + deltaX),
          y: Math.max(6, origin.y + deltaY),
        },
      }));
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleCardClick = (id: string) => {
    if (movedDuringDrag.current) {
      movedDuringDrag.current = false;
      return;
    }
    onNodeClick(id);
  };

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-auto rounded-xl border border-slate-500/40 bg-slate-50/70">
      <div className="relative min-w-[900px]" style={{ minHeight: maxY }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <marker
              id="topology-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="context-stroke" />
            </marker>
          </defs>
          {edges.map((edge) => {
            if (!visibleIdSet.has(edge.from) || !visibleIdSet.has(edge.to)) {
              return null;
            }
            const fromPos = finalPositions.get(edge.from);
            const toPos = finalPositions.get(edge.to);
            if (!fromPos || !toPos) {
              return null;
            }

            const highlighted = pathEdgeSet.has(edgeKey(edge.from, edge.to));
            const visualKey = `${edge.from}-${edge.to}`;
            const hash = hashString(visualKey);
            const color = edgePalette[hash % edgePalette.length];
            const laneOffset = ((hash % 7) - 3) * 6;
            const flowDuration = 1.3 + (hash % 4) * 0.25;
            const fromHeight = cardHeights.get(edge.from) ?? compactCardHeight;
            const toHeight = cardHeights.get(edge.to) ?? compactCardHeight;
            const fromCenterX = fromPos.x + cardWidth / 2;
            const fromCenterY = fromPos.y + fromHeight / 2;
            const toCenterX = toPos.x + cardWidth / 2;
            const toCenterY = toPos.y + toHeight / 2;
            const dx = toCenterX - fromCenterX;
            const dy = toCenterY - fromCenterY;
            const horizontalDominant = Math.abs(dx) >= Math.abs(dy);

            let points = "";

            if (horizontalDominant) {
              const leftToRight = dx >= 0;
              const startX = leftToRight ? fromPos.x + cardWidth : fromPos.x;
              const endX = leftToRight ? toPos.x : toPos.x + cardWidth;
              const startY = fromCenterY + laneOffset;
              const endY = toCenterY + laneOffset;
              const midX = (startX + endX) / 2;
              points = `${startX},${startY} ${midX},${startY} ${midX},${endY} ${endX},${endY}`;
            } else {
              const topToBottom = dy >= 0;
              const startY = topToBottom ? fromPos.y + fromHeight : fromPos.y;
              const endY = topToBottom ? toPos.y : toPos.y + toHeight;
              const startX = fromCenterX + laneOffset;
              const endX = toCenterX + laneOffset;
              const midY = (startY + endY) / 2;
              points = `${startX},${startY} ${startX},${midY} ${endX},${midY} ${endX},${endY}`;
            }

            return (
              <polyline
                key={visualKey}
                points={points}
                fill="none"
                stroke={highlighted ? "#1d4ed8" : color}
                strokeWidth={highlighted ? 3.2 : 2.1}
                strokeDasharray={highlighted ? "7 3" : "5 5"}
                markerEnd="url(#topology-arrow)"
                strokeLinecap="round"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  values="24;0"
                  dur={`${flowDuration}s`}
                  repeatCount="indefinite"
                />
              </polyline>
            );
          })}
        </svg>

        {visibleNodes.map((node) => {
          const pos = finalPositions.get(node.id);
          if (!pos) {
            return null;
          }

          const isExpanded = expandedSet.has(node.id);
          const isHighlighted = highlightedSet.has(node.id);
          const isFocused = focusedId === node.id;
          const isCompact = !isExpanded && !isFocused;
          const height = cardHeights.get(node.id) ?? compactCardHeight;

          return (
            <button
              key={node.id}
              type="button"
              onPointerDown={(event) => handleDragStart(node.id, event, pos)}
              onClick={() => handleCardClick(node.id)}
              className={[
                "absolute rounded-lg border-2 bg-white p-3 text-left shadow-sm transition",
                "hover:-translate-y-[1px] hover:shadow-md",
                statusClass[node.status],
                isFocused ? "ring-2 ring-slate-900" : "",
                isHighlighted ? "ring-2 ring-blue-500" : "",
                isCompact ? "scale-[0.97] opacity-90" : "scale-100",
              ].join(" ")}
              style={{
                left: pos.x,
                top: pos.y,
                width: cardWidth,
                minHeight: height,
              }}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">{node.name}</p>
                <span className="rounded border border-slate-500/50 px-1.5 py-0.5 text-[10px] text-slate-700">
                  {node.type}
                </span>
              </div>
              <p className="mt-1 text-xs uppercase tracking-wide text-slate-600">
                {node.id} • {node.status}
              </p>
              {isExpanded && (
                <div className="mt-2 space-y-0.5 text-[11px] text-slate-700">
                  <p>Capacity: {node.capacity ?? "n/a"}</p>
                  <p>Protocol: {node.protocol ?? "n/a"}</p>
                  <p>Ports: {node.ports?.join(", ") ?? "n/a"}</p>
                  <p>Links: {adjacency.get(node.id)?.length ?? 0}</p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}