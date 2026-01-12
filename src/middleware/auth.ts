import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../lib/jwt';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'nathan') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Super admins can create/manage other admins
// Only nathan@nathanthrower.com and eric.perez.pr@gmail.com have this privilege
const SUPER_ADMIN_EMAILS = [
  'nathan@nathanthrower.com',
  'eric.perez.pr@gmail.com',
];

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const userEmail = req.user?.email;
  const userRole = req.user?.role;

  // Must be nathan role OR be in the super admin list
  if (userRole !== 'nathan' && !SUPER_ADMIN_EMAILS.includes(userEmail || '')) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}
