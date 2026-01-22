/**
 * Audit Service
 *
 * Centralized service for logging all user actions.
 * Provides convenience methods for common operations.
 */

import prisma from '../../lib/prisma';
import {
  AUDIT_ACTIONS,
  AUTH_ACTIONS,
  CRUD_ACTIONS,
  AuditAction,
  EntityType,
  AuditLogOptions,
} from './auditTypes';
import { sanitizeForAudit, computeDiff } from './auditHelpers';

/**
 * Core audit logging function
 */
async function log(
  action: AuditAction | string,
  options: AuditLogOptions & {
    entityType?: EntityType | string;
    entityId?: string;
    oldValue?: Record<string, any> | null;
    newValue?: Record<string, any> | null;
  }
): Promise<void> {
  try {
    // Prepare JSON fields - sanitize and ensure proper type for Prisma
    const sanitizedOldValue = options.oldValue ? sanitizeForAudit(options.oldValue) : null;
    const sanitizedNewValue = options.newValue ? sanitizeForAudit(options.newValue) : null;

    await prisma.auditLog.create({
      data: {
        userId: options.userId ?? null,
        action,
        entityType: options.entityType ?? null,
        entityId: options.entityId ?? null,
        // Only include JSON fields if they have actual data
        ...(sanitizedOldValue && { oldValue: sanitizedOldValue }),
        ...(sanitizedNewValue && { newValue: sanitizedNewValue }),
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
        ...(options.metadata && { metadata: options.metadata }),
      },
    });
  } catch (error) {
    // Log but don't fail the main operation
    console.error('[AuditService] Failed to create audit log:', error);
  }
}

// ==================== Authentication Logging ====================

/**
 * Log successful login
 */
async function logLoginSuccess(
  userId: string,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.LOGIN_SUCCESS, {
    ...options,
    userId,
  });
}

/**
 * Log failed login attempt
 */
async function logLoginFailure(
  options: AuditLogOptions & {
    email?: string;
    reason?: string;
  }
): Promise<void> {
  await log(AUTH_ACTIONS.LOGIN_FAILURE, {
    ...options,
    metadata: {
      ...options.metadata,
      email: options.email,
      reason: options.reason,
    },
  });
}

/**
 * Log logout
 */
async function logLogout(
  userId: string,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.LOGOUT, {
    ...options,
    userId,
  });
}

/**
 * Log logout from all devices
 */
async function logLogoutAll(
  userId: string,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.LOGOUT_ALL, {
    ...options,
    userId,
  });
}

/**
 * Log user registration
 */
async function logRegister(
  userId: string,
  userData: Record<string, any>,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.REGISTER, {
    ...options,
    userId,
    entityType: 'User',
    entityId: userId,
    newValue: userData,
  });
}

/**
 * Log password change
 */
async function logPasswordChange(
  userId: string,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.PASSWORD_CHANGE, {
    ...options,
    userId,
  });
}

/**
 * Log password reset
 */
async function logPasswordReset(
  userId: string,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.PASSWORD_RESET, {
    ...options,
    userId,
  });
}

/**
 * Log account lockout
 */
async function logAccountLocked(
  userId: string,
  options?: AuditLogOptions & {
    attempts?: number;
    lockedUntil?: Date;
  }
): Promise<void> {
  await log(AUTH_ACTIONS.ACCOUNT_LOCKED, {
    ...options,
    userId,
    metadata: {
      ...options?.metadata,
      attempts: options?.attempts,
      lockedUntil: options?.lockedUntil?.toISOString(),
    },
  });
}

/**
 * Log OAuth login (Google, Apple, etc.)
 */
async function logOAuthLogin(
  userId: string,
  provider: string,
  options?: AuditLogOptions
): Promise<void> {
  await log(AUTH_ACTIONS.OAUTH_LOGIN, {
    ...options,
    userId,
    metadata: {
      ...options?.metadata,
      provider,
    },
  });
}

// ==================== CRUD Logging ====================

/**
 * Log entity creation
 */
async function logCreate(
  userId: string | null,
  entityType: EntityType | string,
  entityId: string,
  newValue: Record<string, any>,
  options?: AuditLogOptions
): Promise<void> {
  await log(CRUD_ACTIONS.CREATE, {
    ...options,
    userId,
    entityType,
    entityId,
    newValue,
  });
}

/**
 * Log entity update with automatic diff computation
 */
async function logUpdate(
  userId: string | null,
  entityType: EntityType | string,
  entityId: string,
  oldValue: Record<string, any> | null,
  newValue: Record<string, any> | null,
  options?: AuditLogOptions
): Promise<void> {
  // Compute diff to only store what changed
  const diff = computeDiff(oldValue, newValue);

  // Skip logging if nothing changed
  if (!diff.oldValue && !diff.newValue) {
    return;
  }

  await log(CRUD_ACTIONS.UPDATE, {
    ...options,
    userId,
    entityType,
    entityId,
    oldValue: diff.oldValue,
    newValue: diff.newValue,
  });
}

/**
 * Log entity deletion
 */
async function logDelete(
  userId: string | null,
  entityType: EntityType | string,
  entityId: string,
  oldValue: Record<string, any> | null,
  options?: AuditLogOptions
): Promise<void> {
  await log(CRUD_ACTIONS.DELETE, {
    ...options,
    userId,
    entityType,
    entityId,
    oldValue,
  });
}

// ==================== Custom Action Logging ====================

/**
 * Log a custom action (for entity-specific operations)
 */
async function logAction(
  action: string,
  userId: string | null,
  entityType: EntityType | string,
  entityId: string,
  options?: AuditLogOptions & {
    oldValue?: Record<string, any> | null;
    newValue?: Record<string, any> | null;
  }
): Promise<void> {
  await log(action, {
    ...options,
    userId,
    entityType,
    entityId,
    oldValue: options?.oldValue,
    newValue: options?.newValue,
  });
}

// Export the audit service
export const auditService = {
  log,

  // Auth methods
  logLoginSuccess,
  logLoginFailure,
  logLogout,
  logLogoutAll,
  logRegister,
  logPasswordChange,
  logPasswordReset,
  logAccountLocked,
  logOAuthLogin,

  // CRUD methods
  logCreate,
  logUpdate,
  logDelete,

  // Custom actions
  logAction,
};

// Also export types for convenience
export { AUDIT_ACTIONS, AUTH_ACTIONS, CRUD_ACTIONS } from './auditTypes';
export type { AuditAction, EntityType, AuditLogOptions } from './auditTypes';
