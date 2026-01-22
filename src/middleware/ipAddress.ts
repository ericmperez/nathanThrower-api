/**
 * IP Address Middleware
 *
 * Extracts the client IP address from various headers and
 * attaches it to the request object for use in audit logging.
 */

import { Request, Response, NextFunction } from 'express';

// Extend Express Request type to include clientIp
declare global {
  namespace Express {
    interface Request {
      clientIp?: string;
    }
  }
}

/**
 * Extract client IP from request headers
 *
 * Priority:
 * 1. X-Forwarded-For (first IP in the list)
 * 2. X-Real-IP
 * 3. request.ip (Express default)
 * 4. request.socket.remoteAddress
 */
export function extractClientIp(req: Request): string | undefined {
  // X-Forwarded-For may contain multiple IPs: "client, proxy1, proxy2"
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(',')[0];
    return ips?.trim();
  }

  // X-Real-IP is typically set by nginx
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Express's built-in IP detection
  if (req.ip) {
    // Strip IPv6 prefix if present (::ffff:127.0.0.1 -> 127.0.0.1)
    return req.ip.replace(/^::ffff:/, '');
  }

  // Fallback to socket remote address
  const remoteAddress = req.socket?.remoteAddress;
  if (remoteAddress) {
    return remoteAddress.replace(/^::ffff:/, '');
  }

  return undefined;
}

/**
 * Middleware that attaches client IP to request
 */
export function ipAddressMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  req.clientIp = extractClientIp(req);
  next();
}

export default ipAddressMiddleware;
