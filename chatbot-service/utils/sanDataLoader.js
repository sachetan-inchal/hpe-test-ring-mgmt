import fs from 'fs/promises';
import path from 'path';
import SANData from '../models/SANData.js';
import neo4j from 'neo4j-driver';

// Initialize Neo4j Driver
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASS || 'hpe_san_password')
);

/**
 * Fetches live SAN data from Neo4j to provide real-time context for GraphRAG.
 */
export const getLiveNeo4jData = async () => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (n)
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN collect(DISTINCT {
        id: n.id,
        name: n.name,
        type: labels(n)[0],
        status: n.status,
        ip_address: n.ip_address,
        model: n.model,
        serialNumber: n.serialNumber,
        firmware: n.firmware,
        totalCapacityTb: n.totalCapacityTb,
        usedCapacityTb: n.usedCapacityTb,
        parentId: n.parentId,
        isDecommissioned: n.isDecommissioned
      }) as nodes,
      collect(DISTINCT {
        from: startNode(r).id,
        to: endNode(r).id,
        label: type(r)
      }) as edges
    `);
    const record = result.records[0];
    const nodes = record.get('nodes').filter(n => n.id !== null);
    const edges = record.get('edges').filter(e => e.from !== null && e.to !== null);
    
    if (nodes.length === 0) return null;
    return { nodes, edges };
  } catch (error) {
    console.error('Neo4j GraphRAG Error:', error);
    return null;
  } finally {
    await session.close();
  }
};

// Get SAN data for AI context
export const getSANDataForAI = async () => {
  try {
    // Try live Neo4j data first
    const liveData = await getLiveNeo4jData();
    if (liveData) {
      console.log('Using live Neo4j data for AI context');
      return liveData;
    }

    const sanData = await SANData.findOne({});
    if (!sanData) {
      // Data will now be exclusively loaded by the Python discovery crawler.
      console.log('No SAN data found in MongoDB. Please run the discovery crawler.');
      return { nodes: [], edges: [] };
    }
    return sanData;
  } catch (error) {
    console.error('Error getting SAN data:', error);
    return null;
  }
};

// Search SAN nodes by type, status, or name
export const searchSANNodes = async (query) => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return [];
    
    const { nodes } = sanData;
    const lowerQuery = query.toLowerCase();
    
    return nodes.filter(node => 
      node.name.toLowerCase().includes(lowerQuery) ||
      node.type.toLowerCase().includes(lowerQuery) ||
      node.status.toLowerCase().includes(lowerQuery) ||
      node.id.toLowerCase().includes(lowerQuery)
    );
  } catch (error) {
    console.error('Error searching SAN nodes:', error);
    return [];
  }
};

// Get failed or degraded components
export const getProblematicComponents = async () => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return [];
    
    return sanData.nodes.filter(node => 
      node.status === 'failed' || 
      node.status === 'degraded'
    );
  } catch (error) {
    console.error('Error getting problematic components:', error);
    return [];
  }
};

// Get capacity information
export const getCapacityInfo = async () => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return null;
    
    const arrays = sanData.nodes.filter(node => node.type === 'Array');
    const totalCapacity = arrays.reduce((sum, arr) => sum + (arr.totalCapacityTb || 0), 0);
    const usedCapacity = arrays.reduce((sum, arr) => sum + (arr.usedCapacityTb || 0), 0);
    const freeCapacity = arrays.reduce((sum, arr) => sum + (arr.freeCapacityTb || 0), 0);
    
    return {
      totalArrays: arrays.length,
      totalCapacityTb: totalCapacity,
      usedCapacityTb: usedCapacity,
      freeCapacityTb: freeCapacity,
      utilizationPercentage: totalCapacity > 0 ? ((usedCapacity / totalCapacity) * 100).toFixed(2) : 0,
      arrays: arrays.map(arr => ({
        id: arr.id,
        name: arr.name,
        model: arr.model,
        status: arr.status,
        totalCapacityTb: arr.totalCapacityTb,
        usedCapacityTb: arr.usedCapacityTb,
        freeCapacityTb: arr.freeCapacityTb,
        utilizationPercentage: arr.totalCapacityTb > 0 ? ((arr.usedCapacityTb / arr.totalCapacityTb) * 100).toFixed(2) : 0
      }))
    };
  } catch (error) {
    console.error('Error getting capacity info:', error);
    return null;
  }
};
