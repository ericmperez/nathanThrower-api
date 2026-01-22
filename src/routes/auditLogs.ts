/**
 * Audit Logs API Routes
 *
 * Provides endpoints for viewing audit logs (SUPER_ADMIN only).
 */

import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest, requireSuperAdmin } from '../middleware/auth';
import { AUDIT_ACTIONS } from '../services/audit';

const router = Router();

// Query parameter validation schema
const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
});

/**
 * GET /api/audit-logs
 * List audit logs with filtering and pagination
 * SUPER_ADMIN only
 */
router.get('/', authenticate, requireSuperAdmin, async (req: AuthRequest, res, next) => {
  try {
    const query = auditLogQuerySchema.parse(req.query);
    const { page, limit, userId, action, entityType, entityId, startDate, endDate, search } = query;

    // Build filter conditions
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (action) {
      where.action = action;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (entityId) {
      where.entityId = entityId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Search in metadata (basic text search)
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { ipAddress: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get total count and logs
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Fetch user info for logs that have userId
    const userIds = [...new Set(logs.filter(l => l.userId).map(l => l.userId!))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];

    const userMap = new Map(users.map(u => [u.id, u]));

    // Enhance logs with user info
    const enhancedLogs = logs.map(log => ({
      ...log,
      user: log.userId ? userMap.get(log.userId) ?? null : null,
    }));

    res.json({
      items: enhancedLogs,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

/**
 * GET /api/audit-logs/stats
 * Get audit log statistics for dashboard
 * SUPER_ADMIN only
 */
router.get('/stats', authenticate, requireSuperAdmin, async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get various counts in parallel
    const [totalLogs, last24hCount, last7dCount, actionCounts, recentLogins] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.count({
        where: { createdAt: { gte: last24h } },
      }),
      prisma.auditLog.count({
        where: { createdAt: { gte: last7d } },
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.findMany({
        where: {
          action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILURE'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          action: true,
          userId: true,
          ipAddress: true,
          createdAt: true,
          metadata: true,
        },
      }),
    ]);

    // Fetch user info for recent logins
    const loginUserIds = [...new Set(recentLogins.filter(l => l.userId).map(l => l.userId!))];
    const loginUsers = loginUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: loginUserIds } },
          select: { id: true, email: true, name: true },
        })
      : [];

    const loginUserMap = new Map(loginUsers.map(u => [u.id, u]));

    res.json({
      totalLogs,
      last24hCount,
      last7dCount,
      topActions: actionCounts.map(a => ({
        action: a.action,
        count: a._count.action,
      })),
      recentLogins: recentLogins.map(l => ({
        ...l,
        user: l.userId ? loginUserMap.get(l.userId) ?? null : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit-logs/actions
 * Get list of all available action types
 * SUPER_ADMIN only
 */
router.get('/actions', authenticate, requireSuperAdmin, async (req: AuthRequest, res) => {
  res.json({
    actions: Object.values(AUDIT_ACTIONS),
  });
});

/**
 * GET /api/audit-logs/entity/:type/:id
 * Get audit history for a specific entity
 * SUPER_ADMIN only
 */
router.get('/entity/:type/:id', authenticate, requireSuperAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { type, id } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 100);

    const where = {
      entityType: type,
      entityId: id,
    };

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    // Fetch user info
    const userIds = [...new Set(logs.filter(l => l.userId).map(l => l.userId!))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];

    const userMap = new Map(users.map(u => [u.id, u]));

    const enhancedLogs = logs.map(log => ({
      ...log,
      user: log.userId ? userMap.get(log.userId) ?? null : null,
    }));

    res.json({
      items: enhancedLogs,
      total,
      page: pageNum,
      pageSize: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit-logs/:id
 * Get a single audit log entry
 * SUPER_ADMIN only
 */
router.get('/:id', authenticate, requireSuperAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const log = await prisma.auditLog.findUnique({
      where: { id },
    });

    if (!log) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    // Fetch user info if available
    let user = null;
    if (log.userId) {
      user = await prisma.user.findUnique({
        where: { id: log.userId },
        select: { id: true, email: true, name: true },
      });
    }

    res.json({
      ...log,
      user,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
