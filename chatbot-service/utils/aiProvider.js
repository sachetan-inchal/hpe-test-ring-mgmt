import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { getSANDataForAI, searchSANNodes, getProblematicComponents, getCapacityInfo } from './sanDataLoader.js';
dotenv.config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// AI Provider configuration
const AI_PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    currentModelIndex: 0
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-3.5-turbo', 'gpt-4'],
    currentModelIndex: 0,
    apiKey: process.env.OPENAI_API_KEY
  }
};

// Retry logic with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Retry on rate limit or service unavailable errors
      if (error.message.includes('503') || error.message.includes('429') || 
          error.message.includes('service unavailable') || error.message.includes('rate limit')) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
};

// Gemini API calls
const geminiGenerate = async (history, currentPrompt, modelName = 'gemini-2.5-flash') => {
  const model = genAI.getGenerativeModel({ model: modelName });
  
  const formattedHistory = history.map(msg => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({
    history: formattedHistory,
    generationConfig: {
      maxOutputTokens: 2048,
    },
  });

  const result = await chat.sendMessage(currentPrompt);
  const response = await result.response;
  return response.text();
};

// OpenAI API calls (if you add OpenAI support later)
const openaiGenerate = async (history, currentPrompt, modelName = 'gpt-3.5-turbo') => {
  if (!AI_PROVIDERS.openai.apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    ...history.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content
    })),
    { role: 'user', content: currentPrompt }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_PROVIDERS.openai.apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
};

// Helper function to determine if query is SAN-related
const isSANRelatedQuery = (prompt) => {
  const sanKeywords = [
    'san', 'storage', 'array', 'switch', 'host', 'disk', 'capacity', 'hpe', '3par', 'primera',
    'controller', 'port', 'jbof', 'nvme', 'fc', 'fiber channel', 'wwn', 'zone', 'isomorphic',
    'degraded', 'failed', 'offline', 'normal', 'rack', 'location', 'firmware', 'serial',
    'node', 'cage', 'pci', 'hba', 'multipath', 'linux', 'windows', 'oracle', 'sql'
  ];
  
  const lowerPrompt = prompt.toLowerCase();
  return sanKeywords.some(keyword => lowerPrompt.includes(keyword));
};

// Helper function to get SAN context
const getSANContext = async (prompt) => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return '';
    
    let context = `You are an expert HPE Storage Area Network (SAN) administrator. You have access to the following SAN infrastructure data:\n\n`;
    
    // Add summary statistics
    const arrays = sanData.nodes.filter(n => n.type === 'Array');
    const switches = sanData.nodes.filter(n => n.type === 'Switch');
    const hosts = sanData.nodes.filter(n => n.type === 'Host');
    const failedComponents = sanData.nodes.filter(n => n.status === 'failed' || n.status === 'degraded');
    
    context += `Infrastructure Summary:\n`;
    context += `- Storage Arrays: ${arrays.length} (${arrays.filter(a => a.status === 'normal').length} normal, ${arrays.filter(a => a.status === 'degraded').length} degraded)\n`;
    context += `- Switches: ${switches.length} (${switches.filter(s => s.status === 'normal').length} normal, ${switches.filter(s => s.status === 'degraded').length} degraded)\n`;
    context += `- Hosts: ${hosts.length} connected\n`;
    context += `- Problematic Components: ${failedComponents.length} (failed/degraded)\n\n`;
    
    // Add capacity information if query is about capacity
    if (prompt.toLowerCase().includes('capacity') || prompt.toLowerCase().includes('storage')) {
      const capacityInfo = await getCapacityInfo();
      if (capacityInfo) {
        context += `Capacity Information:\n`;
        context += `- Total Capacity: ${capacityInfo.totalCapacityTb} TB\n`;
        context += `- Used Capacity: ${capacityInfo.usedCapacityTb} TB\n`;
        context += `- Free Capacity: ${capacityInfo.freeCapacityTb} TB\n`;
        context += `- Overall Utilization: ${capacityInfo.utilizationPercentage}%\n\n`;
        
        context += `Array Details:\n`;
        capacityInfo.arrays.forEach(arr => {
          context += `- ${arr.name} (${arr.model}): ${arr.totalCapacityTb} TB total, ${arr.usedCapacityTb} TB used (${arr.utilizationPercentage}% utilization), Status: ${arr.status}\n`;
        });
        context += `\n`;
      }
    }
    
    // Add problematic components if query is about issues
    if (prompt.toLowerCase().includes('problem') || prompt.toLowerCase().includes('issue') || 
        prompt.toLowerCase().includes('failed') || prompt.toLowerCase().includes('degraded') ||
        prompt.toLowerCase().includes('error') || prompt.toLowerCase().includes('alert')) {
      const problems = await getProblematicComponents();
      if (problems.length > 0) {
        context += `Current Issues:\n`;
        problems.forEach(comp => {
          context += `- ${comp.name} (${comp.type}): Status - ${comp.status}\n`;
          if (comp.type === 'Disk' && comp.wearLevel) {
            context += `  Wear Level: ${comp.wearLevel}\n`;
          }
          if (comp.type === 'Port' && comp.state) {
            context += `  Port State: ${comp.state}\n`;
          }
        });
        context += `\n`;
      }
    }
    
    // Add search results for specific components
    const searchResults = await searchSANNodes(prompt);
    if (searchResults.length > 0 && searchResults.length < 10) {
      context += `Relevant Components:\n`;
      searchResults.forEach(comp => {
        context += `- ${comp.name} (${comp.type}, ID: ${comp.id}): Status - ${comp.status}\n`;
        if (comp.model) context += `  Model: ${comp.model}\n`;
        if (comp.serialNumber) context += `  Serial: ${comp.serialNumber}\n`;
        if (comp.firmware) context += `  Firmware: ${comp.firmware}\n`;
        if (comp.totalCapacityTb) context += `  Capacity: ${comp.totalCapacityTb} TB\n`;
        if (comp.locationZone) context += `  Location: ${comp.locationZone}\n`;
      });
      context += `\n`;
    }
    
    context += `Use this information to provide accurate, detailed responses about the SAN infrastructure. `;
    context += `If you need to provide specific technical details, reference the component IDs and names provided. `;
    context += `Always consider the current status of components when providing recommendations.\n\n`;
    
    return context;
  } catch (error) {
    console.error('Error getting SAN context:', error);
    return '';
  }
};

// SAN-specific fallback responses
const getSANFallbackResponse = async (prompt) => {
  const lowerPrompt = prompt.toLowerCase();
  
  // Try to get SAN data for context
  try {
    const sanData = await getSANDataForAI();
    const issues = await getProblematicComponents();
    const capacityInfo = await getCapacityInfo();
    
    // Array status queries
    if (lowerPrompt.includes('array') && lowerPrompt.includes('status')) {
      const arrays = sanData.nodes.filter(n => n.type === 'Array');
      let response = "Based on the current SAN infrastructure data:\n\n";
      arrays.forEach(arr => {
        response += `**${arr.name}** (${arr.model}):\n`;
        response += `- Status: ${arr.status.toUpperCase()}\n`;
        response += `- Capacity: ${arr.totalCapacityTb} TB total, ${arr.usedCapacityTb} TB used (${((arr.usedCapacityTb / arr.totalCapacityTb) * 100).toFixed(1)}% utilization)\n`;
        response += `- Location: ${arr.locationZone}, Rack ${arr.rackRow}\n\n`;
      });
      return response;
    }
    
    // Issues queries
    if (lowerPrompt.includes('issue') || lowerPrompt.includes('problem') || lowerPrompt.includes('failed') || lowerPrompt.includes('degraded')) {
      if (issues.length === 0) {
        return "All SAN components are currently operating normally with no reported issues.";
      }
      
      let response = `Current SAN Infrastructure Issues (${issues.length} total):\n\n`;
      issues.forEach((issue, index) => {
        response += `${index + 1}. **${issue.name}** (${issue.type})\n`;
        response += `   - Status: ${issue.status.toUpperCase()}\n`;
        if (issue.wearLevel) response += `   - Wear Level: ${issue.wearLevel}\n`;
        if (issue.state) response += `   - State: ${issue.state}\n`;
        response += `   - ID: ${issue.id}\n\n`;
      });
      return response;
    }
    
    // Capacity queries
    if (lowerPrompt.includes('capacity') || lowerPrompt.includes('storage')) {
      let response = `Storage Capacity Overview:\n\n`;
      response += `- Total Storage Capacity: ${capacityInfo.totalCapacityTb} TB\n`;
      response += `- Used Capacity: ${capacityInfo.usedCapacityTb} TB\n`;
      response += `- Free Capacity: ${capacityInfo.freeCapacityTb} TB\n`;
      response += `- Overall Utilization: ${capacityInfo.utilizationPercentage}%\n\n`;
      
      response += `Array Details:\n`;
      capacityInfo.arrays.forEach(arr => {
        response += `- ${arr.name}: ${arr.totalCapacityTb} TB (${arr.utilizationPercentage}% utilized) - Status: ${arr.status}\n`;
      });
      return response;
    }
    
    // Disk health queries
    if (lowerPrompt.includes('disk') && (lowerPrompt.includes('health') || lowerPrompt.includes('wear'))) {
      const disks = sanData.nodes.filter(n => n.type === 'Disk');
      const highWearDisks = disks.filter(d => d.wearLevel && parseFloat(d.wearLevel) > 70);
      
      let response = `Disk Health Status:\n\n`;
      response += `- Total Disks: ${disks.length}\n`;
      response += `- Disks with High Wear (>70%): ${highWearDisks.length}\n\n`;
      
      if (highWearDisks.length > 0) {
        response += `High Wear Disks:\n`;
        highWearDisks.forEach(disk => {
          response += `- ${disk.name}: Wear Level ${disk.wearLevel} (${disk.diskModel})\n`;
        });
      }
      return response;
    }
    
    // Switch status queries
    if (lowerPrompt.includes('switch')) {
      const switches = sanData.nodes.filter(n => n.type === 'Switch');
      let response = `Switch Status:\n\n`;
      switches.forEach(sw => {
        response += `**${sw.name}** (${sw.model}):\n`;
        response += `- Status: ${sw.status.toUpperCase()}\n`;
        response += `- Type: ${sw.switchType}\n`;
        response += `- Firmware: ${sw.firmware}\n`;
        if (sw.temperature) response += `- Temperature: ${sw.temperature}°C\n`;
        response += `- Serial: ${sw.serialNumber}\n\n`;
      });
      return response;
    }
    
    // Default response
    return `I can help you with SAN infrastructure queries. Try asking about:\n- Storage array status\n- Current issues or problems\n- Storage capacity and utilization\n- Disk health and wear levels\n- Switch status\n- Component search (by name or ID)\n\nCurrent system has ${sanData.nodes.length} components with ${issues.length} issues reported.`;
    
  } catch (error) {
    return "I'm having trouble accessing the SAN data right now. Please try again in a moment.";
  }
};

// Main AI response generation with fallback
export const generateAIResponse = async (history, currentPrompt) => {
  const errors = [];
  
  // Check if query is SAN-related and add context
  let enhancedPrompt = currentPrompt;
  if (isSANRelatedQuery(currentPrompt)) {
    const sanContext = await getSANContext(currentPrompt);
    if (sanContext) {
      enhancedPrompt = sanContext + `\n\nUser Question: ${currentPrompt}\n\nPlease provide a comprehensive answer based on the SAN infrastructure data provided above.`;
    }
  }
  
  // Try Gemini models first
  for (let i = 0; i < AI_PROVIDERS.gemini.models.length; i++) {
    const modelName = AI_PROVIDERS.gemini.models[i];
    try {
      console.log(`Trying Gemini model: ${modelName}`);
      return await retryWithBackoff(() => geminiGenerate(history, enhancedPrompt, modelName));
    } catch (error) {
      errors.push(`${modelName}: ${error.message}`);
      console.error(`Gemini ${modelName} failed:`, error.message);
      continue;
    }
  }

  // Try OpenAI if available (fallback)
  if (AI_PROVIDERS.openai.apiKey) {
    for (let i = 0; i < AI_PROVIDERS.openai.models.length; i++) {
      const modelName = AI_PROVIDERS.openai.models[i];
      try {
        console.log(`Trying OpenAI model: ${modelName}`);
        return await retryWithBackoff(() => openaiGenerate(history, enhancedPrompt, modelName));
      } catch (error) {
        errors.push(`OpenAI ${modelName}: ${error.message}`);
        console.error(`OpenAI ${modelName} failed:`, error.message);
        continue;
      }
    }
  }

  // If all AI providers fail, use SAN-specific fallback
  console.error('All AI providers failed:', errors);
  if (isSANRelatedQuery(currentPrompt)) {
    console.log('Using SAN fallback response');
    return await getSANFallbackResponse(currentPrompt);
  }

  // Generic fallback for non-SAN queries
  return "I'm experiencing technical difficulties right now. Please try again in a few moments. If the issue persists, contact support.";
};

// Health check for AI providers
export const checkAIProviders = async () => {
  const status = {};
  
  // Check Gemini
  try {
    await geminiGenerate([], 'Hello', 'gemini-2.5-flash');
    status.gemini = 'healthy';
  } catch (error) {
    status.gemini = `unhealthy: ${error.message}`;
  }
  
  // Check OpenAI if API key is available
  if (AI_PROVIDERS.openai.apiKey) {
    try {
      await openaiGenerate([], 'Hello', 'gpt-3.5-turbo');
      status.openai = 'healthy';
    } catch (error) {
      status.openai = `unhealthy: ${error.message}`;
    }
  } else {
    status.openai = 'not configured';
  }
  
  return status;
};
