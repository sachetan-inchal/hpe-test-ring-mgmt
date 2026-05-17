import SANData from '../models/SANData.js';
import { getSANDataForAI, searchSANNodes, getProblematicComponents, getCapacityInfo } from '../utils/sanDataLoader.js';

// Get complete SAN infrastructure data
export const getSANData = async (req, res) => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) {
      return res.status(404).json({ message: 'SAN data not found' });
    }
    res.json(sanData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Load/refresh SAN data
export const refreshSANData = async (req, res) => {
  try {
    const sanData = await getSANDataForAI();
    res.json({ 
      message: 'SAN data is now synced automatically by the discovery crawler.', 
      data: {
        id: sanData._id || 'dynamic',
        name: sanData.name || 'HPE SAN Infrastructure',
        nodesCount: (sanData.nodes || []).length,
        edgesCount: (sanData.edges || []).length,
        lastUpdated: sanData.lastUpdated || new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Search SAN components
export const searchComponents = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }
    
    const results = await searchSANNodes(q);
    res.json({ query: q, results, count: results.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get problematic components (failed/degraded)
export const getIssues = async (req, res) => {
  try {
    const issues = await getProblematicComponents();
    res.json({ issues, count: issues.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get capacity information
export const getCapacity = async (req, res) => {
  try {
    const capacityInfo = await getCapacityInfo();
    if (!capacityInfo) {
      return res.status(404).json({ message: 'Capacity information not found' });
    }
    res.json(capacityInfo);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get component by ID
export const getComponentById = async (req, res) => {
  try {
    const { id } = req.params;
    const sanData = await getSANDataForAI();
    
    if (!sanData) {
      return res.status(404).json({ message: 'SAN data not found' });
    }
    
    const component = sanData.nodes.find(node => node.id === id);
    if (!component) {
      return res.status(404).json({ message: 'Component not found' });
    }
    
    // Get related components (parent and children)
    const parent = sanData.nodes.find(node => node.id === component.parentId);
    const children = sanData.nodes.filter(node => node.parentId === component.id);
    
    // Get connections
    const connections = sanData.edges.filter(edge => 
      edge.from === id || edge.to === id
    ).map(edge => ({
      connectedTo: edge.from === id ? edge.to : edge.from,
      relationship: edge.label,
      direction: edge.from === id ? 'outgoing' : 'incoming'
    }));
    
    res.json({
      component,
      parent: parent || null,
      children,
      connections
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get components by type
export const getComponentsByType = async (req, res) => {
  try {
    const { type } = req.params;
    const sanData = await getSANDataForAI();
    
    if (!sanData) {
      return res.status(404).json({ message: 'SAN data not found' });
    }
    
    const components = sanData.nodes.filter(node => node.type === type);
    res.json({ type, components, count: components.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get network topology (connections between components)
export const getTopology = async (req, res) => {
  try {
    const sanData = await getSANDataForAI();
    
    if (!sanData) {
      return res.status(404).json({ message: 'SAN data not found' });
    }
    
    // Group nodes by type for better visualization
    const nodesByType = {};
    sanData.nodes.forEach(node => {
      if (!nodesByType[node.type]) {
        nodesByType[node.type] = [];
      }
      nodesByType[node.type].push({
        id: node.id,
        name: node.name,
        status: node.status,
        category: node.category
      });
    });
    
    res.json({
      nodes: nodesByType,
      edges: sanData.edges,
      summary: {
        totalNodes: sanData.nodes.length,
        totalEdges: sanData.edges.length,
        nodeTypes: Object.keys(nodesByType),
        normalNodes: sanData.nodes.filter(n => n.status === 'normal').length,
        degradedNodes: sanData.nodes.filter(n => n.status === 'degraded').length,
        failedNodes: sanData.nodes.filter(n => n.status === 'failed').length
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get system health summary
export const getHealthSummary = async (req, res) => {
  try {
    const sanData = await getSANDataForAI();
    
    if (!sanData) {
      return res.status(404).json({ message: 'SAN data not found' });
    }
    
    const issues = await getProblematicComponents();
    const capacityInfo = await getCapacityInfo();
    
    // Calculate health metrics
    const totalComponents = sanData.nodes.length;
    const healthyComponents = sanData.nodes.filter(n => n.status === 'normal').length;
    const healthPercentage = totalComponents > 0 ? ((healthyComponents / totalComponents) * 100).toFixed(2) : 0;
    
    // Critical issues (failed components)
    const criticalIssues = issues.filter(i => i.status === 'failed');
    
    // Warnings (degraded components)
    const warnings = issues.filter(i => i.status === 'degraded');
    
    // System status based on issues
    let systemStatus = 'healthy';
    if (criticalIssues.length > 0) {
      systemStatus = 'critical';
    } else if (warnings.length > 0) {
      systemStatus = 'warning';
    }
    
    res.json({
      systemStatus,
      healthPercentage: parseFloat(healthPercentage),
      summary: {
        totalComponents,
        healthyComponents,
        criticalIssues: criticalIssues.length,
        warnings: warnings.length
      },
      capacity: capacityInfo,
      recentIssues: issues.slice(0, 10), // Show last 10 issues
      recommendations: generateRecommendations(criticalIssues, warnings, capacityInfo)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Helper function to generate recommendations
const generateRecommendations = (criticalIssues, warnings, capacityInfo) => {
  const recommendations = [];
  
  // Critical issues recommendations
  if (criticalIssues.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'critical',
      message: `Immediate attention required: ${criticalIssues.length} component(s) have failed. Replace or repair failed components immediately.`,
      affectedComponents: criticalIssues.map(c => `${c.name} (${c.type})`)
    });
  }
  
  // Warnings recommendations
  if (warnings.length > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'warning',
      message: `${warnings.length} component(s) are degraded. Monitor closely and schedule maintenance.`,
      affectedComponents: warnings.map(c => `${c.name} (${c.type})`)
    });
  }
  
  // Capacity recommendations
  if (capacityInfo && parseFloat(capacityInfo.utilizationPercentage) > 80) {
    recommendations.push({
      priority: 'medium',
      category: 'capacity',
      message: `Storage utilization is at ${capacityInfo.utilizationPercentage}%. Consider capacity planning or data cleanup.`,
      affectedComponents: [`Overall SAN utilization`]
    });
  }
  
  // Disk wear level recommendations
  const highWearDisks = warnings.filter(w => w.type === 'Disk' && w.wearLevel && parseFloat(w.wearLevel) > 80);
  if (highWearDisks.length > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'maintenance',
      message: `${highWearDisks.length} disk(s) have high wear levels (>80%). Plan for replacement.`,
      affectedComponents: highWearDisks.map(c => `${c.name} (Wear: ${c.wearLevel})`)
    });
  }
  
  return recommendations;
};
