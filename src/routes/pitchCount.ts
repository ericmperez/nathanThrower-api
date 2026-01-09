import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { broadcastPitchCountSession } from '../lib/websocket';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Schemas
const CreateSessionSchema = z.object({
  sessionType: z.enum(['game', 'bullpen']),
  age: z.number().int().min(6).max(99),
  notes: z.string().optional(),
  date: z.string().datetime().optional(),
});

const AddPitchSchema = z.object({
  pitchType: z.string().min(1),
  result: z.enum(['strike', 'ball', 'foul', 'hit', 'out']),
});

// GET /api/pitch-count/sessions - Get user's pitch count sessions
router.get('/sessions', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { page = '1', pageSize = '20', sessionType, startDate, endDate } = req.query;

    const where: any = { userId };
    
    if (sessionType) {
      where.sessionType = sessionType;
    }
    
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate as string);
      if (endDate) where.date.lte = new Date(endDate as string);
    }

    const sessions = await prisma.pitchCountSession.findMany({
      where,
      include: {
        pitches: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
      take: parseInt(pageSize as string),
      skip: (parseInt(page as string) - 1) * parseInt(pageSize as string),
    });

    const total = await prisma.pitchCountSession.count({ where });

    res.json({
      sessions,
      pagination: {
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
        total,
        totalPages: Math.ceil(total / parseInt(pageSize as string)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/pitch-count/sessions/:id - Get specific session
router.get('/sessions/:id', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const session = await prisma.pitchCountSession.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        pitches: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  } catch (error) {
    next(error);
  }
});

// POST /api/pitch-count/sessions - Create new session
router.post('/sessions', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const data = CreateSessionSchema.parse(req.body);

    const session = await prisma.pitchCountSession.create({
      data: {
        userId,
        sessionType: data.sessionType,
        age: data.age,
        notes: data.notes,
        date: data.date ? new Date(data.date) : new Date(),
      },
      include: {
        pitches: true,
      },
    });

    // Broadcast real-time event
    broadcastPitchCountSession(userId, session, 'new');

    res.status(201).json({ session });
  } catch (error: any) {
    // Better error handling for common issues
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Session already exists' });
    }
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    if (error.code === 'P2025' || error.message?.includes('does not exist')) {
      return res.status(500).json({ 
        error: 'Database table not found. Please run database migration.',
        hint: 'Run: cd apps/api && npm run db:push'
      });
    }
    console.error('Create session error:', error);
    next(error);
  }
});

// POST /api/pitch-count/sessions/:id/pitches - Add pitch to session
router.post('/sessions/:id/pitches', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const pitchData = AddPitchSchema.parse(req.body);

    // Verify session belongs to user
    const session = await prisma.pitchCountSession.findFirst({
      where: { id, userId },
      include: { pitches: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const pitchCount = session.pitches.length;
    const nextOrder = pitchCount + 1;

    // Get pitch count limits for user's age and session type
    const limit = await prisma.pitchCountLimit.findFirst({
      where: {
        minAge: { lte: session.age },
        maxAge: { gte: session.age },
        sessionType: session.sessionType,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Check if approaching or exceeding limit
    let warning = null;
    let exceeded = false;
    
    if (limit) {
      if (pitchCount + 1 >= limit.maxPitches) {
        exceeded = true;
      } else if (pitchCount + 1 >= limit.warningThreshold) {
        warning = `Approaching limit: ${pitchCount + 1}/${limit.maxPitches} pitches`;
      }
    }

    const pitch = await prisma.pitchCountEntry.create({
      data: {
        sessionId: id,
        pitchType: pitchData.pitchType,
        result: pitchData.result,
        order: nextOrder,
      },
    });

    // Update session updatedAt
    const updatedSession = await prisma.pitchCountSession.update({
      where: { id },
      data: { updatedAt: new Date() },
      include: { pitches: true },
    });

    // Broadcast real-time event
    broadcastPitchCountSession(userId, updatedSession, 'update');

    res.status(201).json({
      pitch,
      warning,
      exceeded,
      currentCount: pitchCount + 1,
      limit: limit?.maxPitches || null,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pitch-count/sessions/:id/pitches/:pitchId - Remove last pitch
router.delete('/sessions/:id/pitches/:pitchId', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { id, pitchId } = req.params;

    // Verify session belongs to user
    const session = await prisma.pitchCountSession.findFirst({
      where: { id, userId },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delete the pitch
    await prisma.pitchCountEntry.delete({
      where: { id: pitchId },
    });

    // Reorder remaining pitches
    const remainingPitches = await prisma.pitchCountEntry.findMany({
      where: { sessionId: id },
      orderBy: { order: 'asc' },
    });

    // Update order numbers
    for (let i = 0; i < remainingPitches.length; i++) {
      await prisma.pitchCountEntry.update({
        where: { id: remainingPitches[i].id },
        data: { order: i + 1 },
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/pitch-count/sessions/:id - Update session
router.patch('/sessions/:id', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { notes, age } = req.body;

    const updateData: any = {};
    if (notes !== undefined) updateData.notes = notes;
    if (age !== undefined) updateData.age = age;

    const session = await prisma.pitchCountSession.updateMany({
      where: { id, userId },
      data: updateData,
    });

    if (session.count === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const updatedSession = await prisma.pitchCountSession.findUnique({
      where: { id },
      include: { pitches: true },
    });

    res.json({ session: updatedSession });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pitch-count/sessions/:id - Delete session
router.delete('/sessions/:id', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const session = await prisma.pitchCountSession.findFirst({
      where: { id, userId },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await prisma.pitchCountSession.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/pitch-count/stats - Get pitch count statistics
router.get('/stats', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { startDate, endDate } = req.query;

    const where: any = { userId };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate as string);
      if (endDate) where.date.lte = new Date(endDate as string);
    }

    const sessions = await prisma.pitchCountSession.findMany({
      where,
      include: {
        pitches: true,
      },
    });

    const totalPitches = sessions.reduce((sum, s) => sum + s.pitches.length, 0);
    const gameSessions = sessions.filter((s) => s.sessionType === 'game');
    const bullpenSessions = sessions.filter((s) => s.sessionType === 'bullpen');

    // Calculate stats by pitch type
    const pitchTypeStats: Record<string, { total: number; strikes: number; balls: number; fouls: number }> = {};
    const resultStats: Record<string, number> = {};

    sessions.forEach((session) => {
      session.pitches.forEach((pitch) => {
        // Pitch type stats
        if (!pitchTypeStats[pitch.pitchType]) {
          pitchTypeStats[pitch.pitchType] = { total: 0, strikes: 0, balls: 0, fouls: 0 };
        }
        pitchTypeStats[pitch.pitchType].total++;
        if (pitch.result === 'strike') pitchTypeStats[pitch.pitchType].strikes++;
        if (pitch.result === 'ball') pitchTypeStats[pitch.pitchType].balls++;
        if (pitch.result === 'foul') pitchTypeStats[pitch.pitchType].fouls++;

        // Result stats
        resultStats[pitch.result] = (resultStats[pitch.result] || 0) + 1;
      });
    });

    res.json({
      totalSessions: sessions.length,
      gameSessions: gameSessions.length,
      bullpenSessions: bullpenSessions.length,
      totalPitches,
      averagePitchesPerSession: sessions.length > 0 ? totalPitches / sessions.length : 0,
      pitchTypeStats,
      resultStats,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/pitch-count/rest-days - Calculate rest days needed
router.get('/rest-days', async (req: AuthRequest, res, next) => {
  try {
    const { age, pitchCount } = req.query;

    if (!age || !pitchCount) {
      return res.status(400).json({ error: 'Age and pitchCount are required' });
    }

    const ageNum = parseInt(age as string);
    const pitchCountNum = parseInt(pitchCount as string);

    // Find matching rest day guideline
    const guideline = await prisma.restDayGuideline.findFirst({
      where: {
        minAge: { lte: ageNum },
        maxAge: { gte: ageNum },
        pitchCountMin: { lte: pitchCountNum },
        OR: [
          { pitchCountMax: { gte: pitchCountNum } },
          { pitchCountMax: null },
        ],
        isActive: true,
      },
      orderBy: [
        { pitchCountMin: 'desc' }, // Most specific guideline first
        { createdAt: 'desc' },
      ],
    });

    const restDays = guideline?.restDays || 0;

    res.json({
      age: ageNum,
      pitchCount: pitchCountNum,
      restDays,
      guideline: guideline ? {
        id: guideline.id,
        pitchCountMin: guideline.pitchCountMin,
        pitchCountMax: guideline.pitchCountMax,
        notes: guideline.notes,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/pitch-count/limits - Get current limits for age
router.get('/limits', async (req: AuthRequest, res, next) => {
  try {
    const { age } = req.query;

    if (!age) {
      return res.status(400).json({ error: 'Age is required' });
    }

    const ageNum = parseInt(age as string);

    const limits = await prisma.pitchCountLimit.findMany({
      where: {
        minAge: { lte: ageNum },
        maxAge: { gte: ageNum },
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ limits });
  } catch (error) {
    next(error);
  }
});

export default router;

