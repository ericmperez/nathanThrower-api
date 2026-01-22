import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { searchSoldItems, getCacheStats } from '../services/ebayService';

const router = Router();

// Validation schema for sold listings query
const SoldListingsQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.coerce.number().min(1).max(50).default(5),
});

/**
 * GET /api/ebay/sold-listings
 * Search for recently sold items on eBay
 * Requires authentication
 */
router.get('/sold-listings', authenticate, async (req: AuthRequest, res, next) => {
  try {
    // Validate query parameters
    const parsed = SoldListingsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.errors,
      });
    }

    const { q: query, limit } = parsed.data;

    // Search eBay for sold items
    const result = await searchSoldItems(query, limit);

    res.json({
      data: result,
    });
  } catch (error: any) {
    console.error('eBay sold listings error:', error);

    // Handle specific error cases
    if (error.message?.includes('credentials not configured')) {
      return res.status(503).json({
        error: 'eBay service unavailable',
        message: 'eBay API is not configured',
      });
    }

    if (error.message?.includes('eBay API error')) {
      return res.status(502).json({
        error: 'eBay API error',
        message: error.message,
      });
    }

    // Pass other errors to the global error handler
    next(error);
  }
});

/**
 * GET /api/ebay/cache-stats
 * Get cache statistics (for debugging/monitoring)
 * Requires authentication
 */
router.get('/cache-stats', authenticate, async (req: AuthRequest, res) => {
  const stats = getCacheStats();
  res.json({ data: stats });
});

export default router;
