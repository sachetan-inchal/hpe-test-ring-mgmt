import express from 'express';
import { checkAIProviders } from '../utils/aiProvider.js';

const router = express.Router();

// Check AI provider health
router.get('/ai', async (req, res) => {
  try {
    const status = await checkAIProviders();
    res.json({
      status: 'success',
      providers: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Database health check
router.get('/db', async (req, res) => {
  const mongoose = (await import('mongoose')).default;
  const state = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized',
  };
  
  res.json({
    status: state === 1 ? 'success' : 'failed',
    connection_state: states[state] || 'unknown',
    uri_present: !!process.env.MONGO_URI,
    timestamp: new Date().toISOString()
  });
});

// General health check
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'HPE Chatbot API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;
