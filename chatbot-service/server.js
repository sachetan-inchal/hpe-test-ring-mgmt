import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import sanRoutes from './routes/sanRoutes.js';
import { resetGenAI } from './utils/aiProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from monorepo root (force override to clear cached Atlas strings)
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const app = express();
const PORT = process.env.CHATBOT_PORT || 5010;

// Middleware
app.use(cors({
  origin: (origin, callback) => callback(null, true), // Allow all origins for RHEL IP access
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/san', sanRoutes);

app.post('/api/config/api-keys', (req, res) => {
  const { GEMINI_API_KEY, OPENAI_API_KEY } = req.body;
  if (GEMINI_API_KEY !== undefined) {
    process.env.GEMINI_API_KEY = GEMINI_API_KEY;
  }
  if (OPENAI_API_KEY !== undefined) {
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;
  }
  resetGenAI();
  res.json({ status: 'success', message: 'API keys updated in chatbot-service' });
});

// Database Connection
connectDB();

app.get('/', (req, res) => {
  res.json({ service: 'HPE SAN Chatbot Service', status: 'running', port: PORT });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  HPE SAN Chatbot Service — http://0.0.0.0:${PORT}`);
  console.log(`${'='.repeat(50)}\n`);
});
