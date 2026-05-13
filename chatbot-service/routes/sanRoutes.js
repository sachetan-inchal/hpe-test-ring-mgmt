import express from 'express';
import {
  getSANData,
  refreshSANData,
  searchComponents,
  getIssues,
  getCapacity,
  getComponentById,
  getComponentsByType,
  getTopology,
  getHealthSummary
} from '../controllers/sanController.js';

const router = express.Router();

// Basic SAN data routes
router.get('/', getSANData);
router.post('/refresh', refreshSANData);

// Search and filter routes
router.get('/search', searchComponents);
router.get('/issues', getIssues);
router.get('/capacity', getCapacity);
router.get('/health', getHealthSummary);

// Component-specific routes
router.get('/component/:id', getComponentById);
router.get('/components/:type', getComponentsByType);

// Network topology
router.get('/topology', getTopology);

export default router;
