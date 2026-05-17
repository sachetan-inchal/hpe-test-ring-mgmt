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

export default function NeuralGraph({ nodes, edges, onNodeClick }) {
  const cyRef = useRef(null);

  const elements = useMemo(() => {
    const cyNodes = nodes.map(n => ({
      data: { 
        id: n.id, 
        label: n.name || n.id, 
        type: n.type,
        color: TYPE_COLORS[n.type] || '#8b949e',
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

  // Premium Custom COSE Force-Directed Layout
  const layoutOptions = {
    name: 'cose',
    animate: true,
    animationDuration: 1000,
    randomize: false,
    fit: true,
    padding: 40,
    gravity: 0.2, // Moderate gravity to keep parts bound, but not collapse clusters
    nodeRepulsion: (node) => {
      const type = node.data('type');
      if (type === 'Array' || type === 'ArraySystem') return 200000;
      if (type === 'Switch') return 80000;
      if (type === 'Host') return 60000;
      if (type === 'Cage') return 30000;
      if (type === 'PhysicalDisk') return 200; // Small repulsion so they group together perfectly around Cages
      return 15000;
    },
    idealEdgeLength: (edge) => {
      const source = edge.source();
      const target = edge.target();
      const sType = source.data('type');
      const tType = target.data('type');
      
      // Keep drives extremely close to their cages
      if ((sType === 'Cage' && tType === 'PhysicalDisk') || (sType === 'PhysicalDisk' && tType === 'Cage')) {
        return 12;
      }
      // Cages close to their array systems
      if ((sType === 'Array' && tType === 'Cage') || (sType === 'Cage' && tType === 'Array') ||
          (sType === 'ArraySystem' && tType === 'Cage') || (sType === 'Cage' && tType === 'ArraySystem')) {
        return 32;
      }
      return 110; // Hosts/switches float a bit wider
    },
    edgeElasticity: (edge) => {
      const source = edge.source();
      const target = edge.target();
      const sType = source.data('type');
      const tType = target.data('type');
      
      // Extremely strong spring for drives to cage
      if ((sType === 'Cage' && tType === 'PhysicalDisk') || (sType === 'PhysicalDisk' && tType === 'Cage')) {
        return 250;
      }
      return 32;
    },
    numIter: 1000,
    initialTemp: 1000,
    coolingFactor: 0.99,
  };

  // Re-run layout dynamically as discovery builds up the graph
  useEffect(() => {
    if (cyRef.current && nodes.length > 0) {
      const cy = cyRef.current;
      cy.layout(layoutOptions).run();
      cy.fit();
    }
  }, [nodes.length, edges.length]);

  const stylesheet = [
    // Default Node styling
    {
      selector: 'node',
      style: {
        'width': '30px',
        'height': '30px',
        'background-color': 'data(color)',
        'label': 'data(label)',
        'color': '#ffffff',
        'font-size': '10px',
        'text-valign': 'center',
        'text-halign': 'center',
        'border-width': '2px',
        'border-color': '#fff',
        'border-opacity': 0.15,
        'overlay-padding': '4px',
        'z-index': 10,
        'font-family': 'Outfit, Inter, sans-serif',
        'font-weight': '600',
        'text-outline-width': '1px',
        'text-outline-color': 'rgba(0,0,0,0.6)',
        'transition-property': 'background-color, border-color, border-width',
        'transition-duration': '0.3s'
      }
    },
    // Main arrays
    {
      selector: 'node[type = "Array"], node[type = "ArraySystem"]',
      style: {
        'width': '44px',
        'height': '44px',
        'font-size': '11px',
        'border-width': '3px',
        'border-color': '#ffffff',
        'border-opacity': 0.3,
        'text-outline-width': '2px',
      }
    },
    // Cages
    {
      selector: 'node[type = "Cage"]',
      style: {
        'width': '28px',
        'height': '28px',
        'font-size': '9px',
        'border-width': '2px',
        'border-color': '#e3a042',
        'border-opacity': 0.3,
      }
    },
    // Physical disks
    {
      selector: 'node[type = "PhysicalDisk"]',
      style: {
        'width': '10px',
        'height': '10px',
        'background-color': '#39c5cf',
        'label': '', // Clean layout: Hide labels by default!
        'border-width': '1px',
        'border-color': '#ffffff',
        'border-opacity': 0.5,
        'z-index': 5,
      }
    },
    // Hovering disk shows detail dynamically
    {
      selector: 'node[type = "PhysicalDisk"]:hover',
      style: {
        'label': 'data(label)',
        'font-size': '8px',
        'color': '#e6edf3',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -4,
        'z-index': 50,
      }
    },
    // Default Edges
    {
      selector: 'edge',
      style: {
        'width': 1.2,
        'line-color': '#30363d',
        'target-arrow-color': '#30363d',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.35,
        'arrow-scale': 0.7,
        'transition-property': 'line-color, opacity',
        'transition-duration': '0.3s'
      }
    },
    // Subtle, clean styling for Physical Disk connections to avoid spiderweb overlap
    {
      selector: 'edge[label = "CONTAINS"]',
      style: {
        'width': 0.8,
        'line-color': '#161b22',
        'target-arrow-shape': 'none', // No arrows for containment to look extremely premium
        'opacity': 0.2,
      }
    },
    // Active connections
    {
      selector: 'edge[label = "CONNECTS_TO"], edge[label = "HAS_SWITCH"]',
      style: {
        'width': 1.5,
        'line-color': '#444c56',
        'opacity': 0.5,
      }
    },
    // Selection styles
    {
      selector: ':selected',
      style: {
        'background-color': '#ffffff',
        'line-color': '#58a6ff',
        'target-arrow-color': '#58a6ff',
        'source-arrow-color': '#58a6ff',
        'opacity': 1,
        'border-width': '4px',
        'border-color': 'data(color)',
        'border-opacity': 0.8,
      }
    }
  ];

  return (
    <div style={{ width: '100%', height: '100%', background: '#080c10' }}>
      <CytoscapeComponent
        elements={elements}
        style={{ width: '100%', height: '100%' }}
        stylesheet={stylesheet}
        layout={layoutOptions}
        cy={(cy) => {
          cyRef.current = cy;
          
          // Clear previous click/hover binds to prevent leakage
          cy.off('tap', 'node');
          cy.on('tap', 'node', (evt) => {
            const nodeData = nodes.find(n => n.id === evt.target.id());
            if (nodeData) onNodeClick(nodeData);
          });
        }}
      />
    </div>
  );
}
