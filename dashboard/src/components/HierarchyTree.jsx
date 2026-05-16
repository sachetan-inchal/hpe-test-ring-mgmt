import { useMemo, useRef, useState } from "react";

const cardWidth = 190;
const compactCardHeight = 90;
const expandedCardHeight = 156;
const focusedBump = 14;
const horizontalGap = 68;
const verticalGap = 24;
const canvasPadding = 32;

const statusStyle = {
  normal: { border: "1px solid rgba(4, 120, 87, 0.6)", background: "rgba(236, 253, 245, 0.05)" },
  degraded: { border: "1px solid rgba(180, 83, 9, 0.6)", background: "rgba(255, 251, 235, 0.05)" },
  failed: { border: "1px solid rgba(190, 18, 60, 0.6)", background: "rgba(255, 241, 242, 0.05)" },
};

const edgePalette = ["#0284c7", "#16a34a", "#dc2626", "#7c3aed", "#ea580c", "#0f766e"];

function edgeKey(a, b) {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export default function HierarchyTree({
  nodes,
  edges,
  visibleIds = [],
  expandedIds = [],
  highlightedIds = [],
  pathIds = [],
  focusedId,
  rootIds = [],
  onNodeClick,
}) {
  const [manualPositions, setManualPositions] = useState({});
  const movedDuringDrag = useRef(false);

  const visibleIdSet = useMemo(() => new Set(visibleIds.length ? visibleIds : nodes.map(n => n.id)), [visibleIds, nodes]);
  const expandedSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const highlightedSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => visibleIdSet.has(node.id)),
    [nodes, visibleIdSet]
  );

  const adjacency = useMemo(() => {
    const map = new Map();
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
    const map = new Map();
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
    const depthMap = new Map();
    const queue = [];

    const startIds = rootIds.length > 0 ? rootIds : visibleNodes.filter(n => n.type === 'Host').map(n => n.id);
    if (startIds.length === 0 && visibleNodes.length > 0) startIds.push(visibleNodes[0].id);

    for (const rootId of startIds) {
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

    const byDepth = new Map();
    for (const node of visibleNodes) {
      const depth = depthMap.get(node.id) ?? 0;
      const bucket = byDepth.get(depth) ?? [];
      bucket.push(node.id);
      byDepth.set(depth, bucket);
    }

    const result = new Map();
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
    const merged = new Map();
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
    const set = new Set();
    for (let i = 0; i < (pathIds || []).length - 1; i += 1) {
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
    nodeId,
    event,
    origin
  ) => {
    if (event.button !== 0) {
      return;
    }

    movedDuringDrag.current = false;
    const startX = event.clientX;
    const startY = event.clientY;

    const onPointerMove = (moveEvent) => {
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

  const handleCardClick = (id) => {
    if (movedDuringDrag.current) {
      movedDuringDrag.current = false;
      return;
    }
    if (onNodeClick) onNodeClick(id);
  };

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 420, width: '100%', overflow: 'auto', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-1)' }}>
      <div style={{ position: 'relative', minWidth: 900, minHeight: maxY }}>
        <svg style={{ pointerEvents: 'none', position: 'absolute', inset: 0, height: '100%', width: '100%' }} aria-hidden>
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
                stroke={highlighted ? "var(--accent-blue)" : color}
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
              style={{
                position: 'absolute',
                borderRadius: 8,
                padding: 12,
                textAlign: 'left',
                boxShadow: isFocused ? '0 0 0 2px var(--foreground)' : isHighlighted ? '0 0 0 2px var(--accent-blue)' : '0 1px 4px 0 rgba(0, 0, 0, 0.2)',
                transition: 'all 0.15s ease',
                transform: isCompact ? 'scale(0.97)' : 'scale(1)',
                opacity: isCompact ? 0.9 : 1,
                left: pos.x,
                top: pos.y,
                width: cardWidth,
                minHeight: height,
                cursor: 'pointer',
                color: 'var(--foreground)',
                ...statusStyle[node.status || 'normal']
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{node.name}</p>
                <span style={{ borderRadius: 4, border: '1px solid rgba(139,148,158,0.5)', padding: '2px 6px', fontSize: 10 }}>
                  {node.type}
                </span>
              </div>
              <p style={{ marginTop: 4, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.025em', opacity: 0.8 }}>
                {node.id} • {node.status || 'normal'}
              </p>
              {isExpanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, opacity: 0.9 }}>
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
