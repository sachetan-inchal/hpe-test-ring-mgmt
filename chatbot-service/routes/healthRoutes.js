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

// General health check
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'HPE Chatbot API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;
