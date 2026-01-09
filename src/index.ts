import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import videosRoutes from './routes/videos';
import analysesRoutes from './routes/analyses';
import coursesRoutes from './routes/courses';
import messagesRoutes from './routes/messages';
import adminRoutes from './routes/admin';
import webhooksRoutes from './routes/webhooks';
import referralsRoutes from './routes/referrals';
import notificationsRoutes from './routes/notifications';
import pitchCountRoutes from './routes/pitchCount';
import workoutsRoutes from './routes/workouts';
import { errorHandler } from './middleware/errorHandler';
import { initWebSocket } from './lib/websocket';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;

// Initialize WebSocket server
initWebSocket(httpServer);

// Middleware
// CORS configuration - allow all origins for now (mobile apps + web dashboard)
// TODO: Restrict to specific origins in production when domains are finalized
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('dev'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videosRoutes);
app.use('/api/analyses', analysesRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/pitch-count', pitchCountRoutes);
app.use('/api/workouts', workoutsRoutes);

// Error handler
app.use(errorHandler);

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Nathan Thrower API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 WebSocket server initialized`);
});

export default app;
