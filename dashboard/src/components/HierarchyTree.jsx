import { useMemo, useRef, useState } from "react";

const cardWidth = 220;
const compactCardHeight = 90;
const expandedCardHeight = 156;
const focusedBump = 14;
const horizontalGap = 180;
const verticalGap = 44;
const canvasPadding = 56;

const statusStyle = {
  normal: { border: "1px solid rgba(4, 120, 87, 0.6)", background: "rgba(236, 253, 245, 0.05)" },
  degraded: { border: "1px solid rgba(180, 83, 9, 0.6)", background: "rgba(255, 251, 235, 0.05)" },
  failed: { border: "1px solid rgba(190, 18, 60, 0.6)", background: "rgba(255, 241, 242, 0.05)" },
};

const edgePalette = ["#0284c7", "#16a34a", "#dc2626", "#7c3aed", "#ea580c", "#0f766e"];
const columnOrder = [
  "Array",
  "Switch",
  "Cage",
  "JBOF",
  "Node",
  "Host",
  "Disk",
  "Port",
  "PCI_Device",
  "Other",
];

function normalizeType(type) {
  const t = String(type || "").trim();
  if (t === "Array" || t === "ArraySystem") return "Array";
  if (t === "Switch") return "Switch";
  if (t === "Cage") return "Cage";
  if (t === "JBOF") return "JBOF";
  if (t === "Node" || t === "Controller") return "Node";
  if (t === "Host") return "Host";
  if (t === "Disk" || t === "PhysicalDisk") return "Disk";
  if (t === "Port") return "Port";
  if (t === "PCI_Device") return "PCI_Device";
  return "Other";
}

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

  const nodeById = useMemo(() => {
    const map = new Map();
    for (const node of visibleNodes) {
      map.set(node.id, node);
    }
    return map;
  }, [visibleNodes]);

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

  const typeColumns = useMemo(() => {
    const map = new Map();
    for (const key of columnOrder) {
      map.set(key, []);
    }

    for (const node of visibleNodes) {
      const column = normalizeType(node.type);
      map.get(column)?.push(node.id);
    }

    const nonEmptyOrdered = columnOrder.filter((key) => (map.get(key)?.length || 0) > 0);
    nonEmptyOrdered.forEach((key) => {
      const ids = map.get(key) || [];
      ids.sort((a, b) => {
        const left = nodeById.get(a);
        const right = nodeById.get(b);
        const leftName = (left?.name || a).toLowerCase();
        const rightName = (right?.name || b).toLowerCase();
        return leftName.localeCompare(rightName);
      });
    });

    return nonEmptyOrdered.map((key) => ({ key, ids: map.get(key) || [] }));
  }, [nodeById, visibleNodes]);

  const positions = useMemo(() => {
    const result = new Map();
    const topPadding = canvasPadding + 44;

    typeColumns.forEach((col, colIndex) => {
      let yCursor = topPadding;
      col.ids.forEach((id) => {
        const height = cardHeights.get(id) ?? compactCardHeight;
        const extraGap = expandedSet.has(id) ? 14 : 0;
        result.set(id, {
          x: canvasPadding + colIndex * (cardWidth + horizontalGap),
          y: yCursor,
        });
        yCursor += height + verticalGap + extraGap;
      });
    });

    return result;
  }, [cardHeights, expandedSet, typeColumns]);

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

  const focusedEdgeSet = useMemo(() => {
    const set = new Set();
    if (!focusedId) {
      return set;
    }
    for (const edge of edges) {
      if ((edge.from === focusedId || edge.to === focusedId) && visibleIdSet.has(edge.from) && visibleIdSet.has(edge.to)) {
        set.add(`${edge.from}-${edge.to}`);
      }
    }
    return set;
  }, [edges, focusedId, visibleIdSet]);

  const maxY = useMemo(() => {
    let value = 560;
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

  const maxX = useMemo(() => {
    return Math.max(1280, canvasPadding * 2 + (typeColumns.length || 1) * cardWidth + Math.max(0, typeColumns.length - 1) * horizontalGap);
  }, [typeColumns]);

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
      <div style={{ position: 'relative', minWidth: maxX, minHeight: maxY }}>
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, display: 'flex', pointerEvents: 'none' }}>
          {typeColumns.map((col, colIndex) => (
            <div
              key={col.key}
              style={{
                position: 'absolute',
                left: canvasPadding + colIndex * (cardWidth + horizontalGap),
                width: cardWidth,
                textAlign: 'center',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                fontWeight: 700,
              }}
            >
              {col.key}
            </div>
          ))}
        </div>
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
            const focusLinked = focusedEdgeSet.has(`${edge.from}-${edge.to}`) || focusedEdgeSet.has(`${edge.to}-${edge.from}`);
            const visualKey = `${edge.from}-${edge.to}`;
            const hash = hashString(visualKey);
            const color = edgePalette[hash % edgePalette.length];
            const laneOffset = ((hash % 9) - 4) * 6;
            const fromHeight = cardHeights.get(edge.from) ?? compactCardHeight;
            const toHeight = cardHeights.get(edge.to) ?? compactCardHeight;
            const fromType = normalizeType(nodeById.get(edge.from)?.type);
            const toType = normalizeType(nodeById.get(edge.to)?.type);
            const fromColumn = typeColumns.findIndex((col) => col.key === fromType);
            const toColumn = typeColumns.findIndex((col) => col.key === toType);
            const leftToRight = fromColumn <= toColumn;
            const startX = leftToRight ? fromPos.x + cardWidth : fromPos.x;
            const endX = leftToRight ? toPos.x : toPos.x + cardWidth;
            const fromCenterY = fromPos.y + fromHeight / 2;
            const toCenterY = toPos.y + toHeight / 2;
            const startY = fromCenterY + laneOffset;
            const endY = toCenterY + laneOffset;
            const deltaX = Math.abs(endX - startX);
            const c1x = startX + (leftToRight ? 1 : -1) * Math.max(36, deltaX * 0.35);
            const c2x = endX - (leftToRight ? 1 : -1) * Math.max(36, deltaX * 0.35);
            const pathD = `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`;
            const edgeOpacity = highlighted ? 0.95 : focusLinked ? 0.8 : focusedId ? 0.16 : 0.35;
            const edgeStroke = highlighted ? "var(--accent-blue)" : focusLinked ? "var(--accent-green)" : color;

            return (
              <g key={visualKey}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={edgeStroke}
                  strokeWidth={highlighted ? 3 : focusLinked ? 2.4 : 1.4}
                  strokeOpacity={edgeOpacity}
                  markerEnd="url(#topology-arrow)"
                  strokeLinecap="round"
                />
              </g>
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
