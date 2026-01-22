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
import chatsRoutes from './routes/chats';
import adminRoutes from './routes/admin';
import webhooksRoutes from './routes/webhooks';
import referralsRoutes from './routes/referrals';
import notificationsRoutes from './routes/notifications';
import pitchCountRoutes from './routes/pitchCount';
import workoutsRoutes from './routes/workouts';
import trainingProgramsRoutes from './routes/trainingPrograms';
import contentRoutes from './routes/content';
import auditLogsRoutes from './routes/auditLogs';
import { errorHandler } from './middleware/errorHandler';
import { ipAddressMiddleware } from './middleware/ipAddress';
import { initWebSocket } from './lib/websocket';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;

// Initialize WebSocket server
initWebSocket(httpServer);

// Middleware
// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // In development, allow localhost
    if (process.env.NODE_ENV !== 'production') {
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
    }

    // Check against allowed origins
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(ipAddressMiddleware); // Extract client IP for audit logging

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
app.use('/api/chats', chatsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/pitch-count', pitchCountRoutes);
app.use('/api/workouts', workoutsRoutes);
app.use('/api/training-programs', trainingProgramsRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/audit-logs', auditLogsRoutes);

// Error handler
app.use(errorHandler);

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Nathan Thrower API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 WebSocket server initialized`);
});

export default app;
