/**
 * Lightweight tool definitions for tool-calling backends (Ollama "chat" API).
 * These are intentionally small and deterministic so the model can call them reliably.
 *
 * NOTE: Tool *execution* happens on this server (Node.js). The model only requests calls.
 */

import {
  getSANDataForAI,
  searchSANNodes,
  getProblematicComponents,
  getCapacityInfo,
} from './sanDataLoader.js';

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_problematic_components',
      description: 'List current SAN components that are in failed/degraded/problem states.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max number of items to return', default: 20 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_capacity_summary',
      description: 'Return aggregated storage capacity metrics (total/used/free/utilization).',
      parameters: {
        type: 'object',
        properties: {
          include_arrays: { type: 'boolean', description: 'Whether to include per-array capacity details', default: true },
          limit_arrays: { type: 'integer', description: 'Max number of arrays to return', default: 20 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_components',
      description: 'Search SAN components by user prompt keywords (name, id, model, status etc).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query from the user' },
          limit: { type: 'integer', description: 'Max results', default: 10 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_san_overview',
      description: 'Return a high-level SAN overview counts (arrays/switches/hosts/problematic components).',
      parameters: {
        type: 'object',
        properties: {
          include_counts: { type: 'boolean', description: 'Return counts only', default: true },
        },
        required: [],
      },
    },
  },
];

function safeJsonParse(maybeJson) {
  if (maybeJson == null) return {};
  if (typeof maybeJson === 'object') return maybeJson;
  if (typeof maybeJson !== 'string') return {};
  try {
    return JSON.parse(maybeJson);
  } catch {
    // Ollama sometimes provides already-parsed args; otherwise return empty.
    return {};
  }
}

export const toolDefinitions = TOOL_DEFINITIONS;

export async function executeToolCall(toolName, rawArgs) {
  const args = safeJsonParse(rawArgs);

  switch (toolName) {
    case 'list_problematic_components': {
      const limit = Number.isFinite(args.limit) ? args.limit : 20;
      const problems = await getProblematicComponents();
      return (problems || []).slice(0, limit);
    }

    case 'get_capacity_summary': {
      const includeArrays = args.include_arrays !== false;
      const limitArrays = Number.isFinite(args.limit_arrays) ? args.limit_arrays : 20;
      const cap = await getCapacityInfo();

      if (!cap) return null;

      const result = {
        totalCapacityTb: cap.totalCapacityTb,
        usedCapacityTb: cap.usedCapacityTb,
        freeCapacityTb: cap.freeCapacityTb,
        utilizationPercentage: cap.utilizationPercentage,
      };

      if (includeArrays && Array.isArray(cap.arrays)) {
        result.arrays = cap.arrays.slice(0, limitArrays).map(a => ({
          name: a.name,
          model: a.model,
          totalCapacityTb: a.totalCapacityTb,
          usedCapacityTb: a.usedCapacityTb,
          utilizationPercentage: a.utilizationPercentage,
          status: a.status,
        }));
      }

      return result;
    }

    case 'search_components': {
      const query = String(args.query || '').trim();
      const limit = Number.isFinite(args.limit) ? args.limit : 10;
      if (!query) return [];
      const results = await searchSANNodes(query);
      return (results || []).slice(0, limit);
    }

    case 'get_san_overview': {
      const sanData = await getSANDataForAI();
      const nodes = sanData?.nodes || [];
      const arrays = nodes.filter(n => n.type === 'Array');
      const switches = nodes.filter(n => n.type === 'Switch');
      const hosts = nodes.filter(n => n.type === 'Host');
      const failed = nodes.filter(n => n.status === 'failed' || n.status === 'degraded');

      return {
        arrays: arrays.length,
        switches: switches.length,
        hosts: hosts.length,
        problematicComponents: failed.length,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
