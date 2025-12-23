import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

// Redis client for rate limiting (production)
let redisClient: Redis | null = null;
const isProduction = process.env.NODE_ENV === 'production';

// Initialize Redis connection if in production or REDIS_HOST is set
if (isProduction || process.env.REDIS_HOST) {
  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: true, // Connect on first use, not at startup
      enableReadyCheck: true,
    });

    redisClient.on('error', (err) => {
      console.error('Redis rate limiting error:', err);
      // Fall back to in-memory if Redis fails
      redisClient = null;
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis rate limiting connected');
    });
  } catch (error) {
    console.error('Failed to initialize Redis for rate limiting:', error);
    redisClient = null;
  }
}

// In-memory store for rate limiting (fallback/development)
const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
    windowMs: number;     // Time window in milliseconds
    maxRequests: number;  // Max requests per window
    message?: string;     // Error message
}

/**
 * Rate limiting middleware to prevent brute force attacks
 * Uses Redis in production for distributed rate limiting, falls back to in-memory for development
 * Required for App Store approval - demonstrates security best practices
 */
export function rateLimit(options: RateLimitOptions) {
    const { windowMs, maxRequests, message = 'Too many requests, please try again later' } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const key = `ratelimit:${ip}:${req.path}`;
        const now = Date.now();

        try {
            if (redisClient && (redisClient.status === 'ready' || redisClient.status === 'connecting')) {
                // Use Redis for distributed rate limiting (production)
                const redisKey = key;
                const ttl = Math.ceil(windowMs / 1000); // Convert to seconds

                // Check current count
                const count = await redisClient.get(redisKey);
                const currentCount = count ? parseInt(count, 10) : 0;

                if (currentCount >= maxRequests) {
                    // Rate limit exceeded - get TTL
                    const remainingTTL = await redisClient.ttl(redisKey);
                    const retryAfter = Math.max(remainingTTL, 1);
                    res.set('Retry-After', String(retryAfter));
                    return res.status(429).json({
                        error: message,
                        retryAfter,
                    });
                }

                // Increment counter and set expiry
                const newCount = await redisClient.incr(redisKey);
                if (newCount === 1) {
                    // First request - set expiry
                    await redisClient.expire(redisKey, ttl);
                }

                return next();
            } else {
                // Fallback to in-memory store (development or Redis unavailable)
                const entry = rateLimitStore.get(key);

                if (!entry || now > entry.resetTime) {
                    // First request or window expired
                    rateLimitStore.set(key, {
                        count: 1,
                        resetTime: now + windowMs,
                    });
                    return next();
                }

                if (entry.count >= maxRequests) {
                    // Rate limit exceeded
                    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
                    res.set('Retry-After', String(retryAfter));
                    return res.status(429).json({
                        error: message,
                        retryAfter,
                    });
                }

                // Increment counter
                entry.count++;
                rateLimitStore.set(key, entry);
                next();
            }
        } catch (error) {
            // If Redis fails, log error and allow request (fail open for availability)
            console.error('Rate limiting error:', error);
            // Continue to next middleware - fail open to prevent Redis issues from blocking requests
            return next();
        }
    };
}

/**
 * Strict rate limit for auth endpoints
 * 5 attempts per 15 minutes
 */
export const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many login attempts. Please try again in 15 minutes.',
});

/**
 * Standard API rate limit
 * 100 requests per minute
 */
export const apiRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    message: 'Rate limit exceeded. Please slow down.',
});

// Cleanup old entries every 5 minutes (only for in-memory store)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
        if (now > entry.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Graceful shutdown - close Redis connection
process.on('SIGTERM', () => {
    if (redisClient) {
        redisClient.quit();
    }
});

process.on('SIGINT', () => {
    if (redisClient) {
        redisClient.quit();
    }
});
