import React, { useMemo, useEffect, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';

const TYPE_COLORS = {
  Array: '#58a6ff',
  ArraySystem: '#58a6ff',
  Switch: '#bc8cff',
  Host: '#3fb950',
  Cage: '#e3a042',
  PhysicalDisk: '#39c5cf',
  Port: '#d29922',
  Node: '#8b949e',
  Device: '#8b949e',
};

const TYPE_RANK = {
  Array: 10,
  ArraySystem: 10,
  Switch: 5,
  Host: 2,
  Node: 1,
  Cage: 1,
  PhysicalDisk: 0,
};

export default function NeuralGraph({ nodes, edges, onNodeClick }) {
  const cyRef = useRef(null);

  const elements = useMemo(() => {
    const cyNodes = nodes.map(n => ({
      data: { 
        id: n.id, 
        label: n.name || n.id, 
        type: n.type,
        color: TYPE_COLORS[n.type] || '#8b949e',
        rank: TYPE_RANK[n.type] || 0
      }
    }));

    const cyEdges = edges.map(e => ({
      data: { 
        id: e.id || `${e.from}-${e.to}`,
        source: e.from, 
        target: e.to,
        label: e.label 
      }
    }));

    return [...cyNodes, ...cyEdges];
  }, [nodes, edges]);

  // Hierarchical Concentric Layout (Arrays at center)
  const layoutOptions = {
    name: 'concentric',
    concentric: (node) => node.data('rank'),
    levelWidth: () => 1,
    padding: 60,
    animate: true,
    animationDuration: 800,
    spacingFactor: 1.5,
    minNodeSpacing: 50,
  };

  // Re-run layout when nodes/edges change to show "expansion"
  useEffect(() => {
    if (cyRef.current && nodes.length > 0) {
      const cy = cyRef.current;
      cy.layout(layoutOptions).run();
      cy.fit();
    }
  }, [nodes.length, edges.length]);

  const stylesheet = [
    {
      selector: 'node',
      style: {
        'width': '36px',
        'height': '36px',
        'background-color': 'data(color)',
        'label': 'data(label)',
        'color': '#fff',
        'font-size': '10px',
        'text-valign': 'center',
        'text-halign': 'center',
        'border-width': '2px',
        'border-color': '#fff',
        'border-opacity': 0.2,
        'overlay-padding': '6px',
        'z-index': 10,
        'font-family': 'Inter, sans-serif',
        'font-weight': 'bold',
        'text-outline-width': '1px',
        'text-outline-color': 'rgba(0,0,0,0.5)',
        'transition-property': 'background-color, line-color, target-arrow-color',
        'transition-duration': '0.5s'
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 1.2,
        'line-color': '#30363d',
        'target-arrow-color': '#30363d',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.4,
        'arrow-scale': 0.8
      }
    },
    {
      selector: ':selected',
      style: {
        'background-color': '#fff',
        'line-color': '#fff',
        'target-arrow-color': '#fff',
        'source-arrow-color': '#fff',
        'opacity': 1,
        'border-width': '4px',
        'border-color': 'data(color)',
      }
    }
  ];

  return (
    <div style={{ width: '100%', height: '100%', background: '#0d1117' }}>
      <CytoscapeComponent
        elements={elements}
        style={{ width: '100%', height: '100%' }}
        stylesheet={stylesheet}
        layout={layoutOptions}
        cy={(cy) => {
          cyRef.current = cy;
          cy.on('tap', 'node', (evt) => {
            const nodeData = nodes.find(n => n.id === evt.target.id());
            if (nodeData) onNodeClick(nodeData);
          });
        }}
      />
    </div>
  );
}
