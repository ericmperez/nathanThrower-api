/**
 * Audit Log Action Types
 *
 * Categorized by operation type for easy filtering and analysis.
 */

// Authentication Actions
export const AUTH_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  REGISTER: 'REGISTER',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  OAUTH_LOGIN: 'OAUTH_LOGIN',
} as const;

// CRUD Actions
export const CRUD_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const;

// Entity-Specific Actions
export const ENTITY_ACTIONS = {
  // User actions
  USER_DEACTIVATE: 'USER_DEACTIVATE',
  USER_REACTIVATE: 'USER_REACTIVATE',
  USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',

  // Pawn Loan actions
  LOAN_REDEEM: 'LOAN_REDEEM',
  LOAN_FORFEIT: 'LOAN_FORFEIT',
  LOAN_EXTEND: 'LOAN_EXTEND',
  LOAN_PAYMENT: 'LOAN_PAYMENT',

  // Settings actions
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
} as const;

// Combine all action types
export const AUDIT_ACTIONS = {
  ...AUTH_ACTIONS,
  ...CRUD_ACTIONS,
  ...ENTITY_ACTIONS,
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];
export type AuthAction = typeof AUTH_ACTIONS[keyof typeof AUTH_ACTIONS];
export type CrudAction = typeof CRUD_ACTIONS[keyof typeof CRUD_ACTIONS];
export type EntityAction = typeof ENTITY_ACTIONS[keyof typeof ENTITY_ACTIONS];

// Entity types that can be audited
export const ENTITY_TYPES = {
  USER: 'User',
  PAWN_LOAN: 'PawnLoan',
  LOAN_PAYMENT: 'LoanPayment',
  SYSTEM_SETTING: 'SystemSetting',
  SUBSCRIPTION: 'Subscription',
  COURSE: 'Course',
  LESSON: 'Lesson',
  TRAINING_PROGRAM: 'TrainingProgram',
  REFERRAL: 'Referral',
} as const;

export type EntityType = typeof ENTITY_TYPES[keyof typeof ENTITY_TYPES];

// Audit log entry interface (matches Prisma model)
export interface AuditLogEntry {
  id?: string;
  userId: string | null;
  action: AuditAction | string;
  entityType?: EntityType | string | null;
  entityId?: string | null;
  oldValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date;
}

// Options for creating audit logs
export interface AuditLogOptions {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
}
