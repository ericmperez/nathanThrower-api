/**
 * Audit Log Helper Functions
 *
 * Utilities for computing diffs, redacting sensitive fields, and
 * preparing data for audit logging.
 */

// Fields that should never be stored in audit logs
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'token',
  'emailVerificationToken',
  'passwordResetToken',
  'secret',
  'apiKey',
  'privateKey',
]);

// Fields that should be partially redacted (show existence but not value)
const REDACT_PARTIAL_FIELDS = new Set([
  'email', // Show as "[REDACTED]@..." pattern
]);

/**
 * Deep clone an object, removing sensitive fields
 */
export function sanitizeForAudit<T extends Record<string, any>>(
  obj: T | null | undefined
): Record<string, any> | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Skip sensitive fields entirely
    if (SENSITIVE_FIELDS.has(lowerKey) || SENSITIVE_FIELDS.has(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Handle nested objects
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      sanitized[key] = sanitizeForAudit(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === 'object' && item !== null ? sanitizeForAudit(item) : item
      );
    } else if (value instanceof Date) {
      sanitized[key] = value.toISOString();
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Compute the difference between two objects
 * Returns only the fields that changed, with old and new values
 */
export function computeDiff(
  oldObj: Record<string, any> | null | undefined,
  newObj: Record<string, any> | null | undefined
): { oldValue: Record<string, any> | null; newValue: Record<string, any> | null } {
  // If one is null/undefined, return the other as-is
  if (!oldObj && !newObj) {
    return { oldValue: null, newValue: null };
  }

  if (!oldObj) {
    return { oldValue: null, newValue: sanitizeForAudit(newObj) };
  }

  if (!newObj) {
    return { oldValue: sanitizeForAudit(oldObj), newValue: null };
  }

  const oldDiff: Record<string, any> = {};
  const newDiff: Record<string, any> = {};

  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    // Skip if values are the same
    if (isEqual(oldVal, newVal)) {
      continue;
    }

    // Handle sensitive fields
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey) || SENSITIVE_FIELDS.has(key)) {
      // Only record that a sensitive field changed, not its value
      if (oldVal !== undefined) oldDiff[key] = '[REDACTED]';
      if (newVal !== undefined) newDiff[key] = '[REDACTED]';
      continue;
    }

    // Record the difference
    if (oldVal !== undefined) {
      oldDiff[key] = oldVal instanceof Date ? oldVal.toISOString() : oldVal;
    }
    if (newVal !== undefined) {
      newDiff[key] = newVal instanceof Date ? newVal.toISOString() : newVal;
    }
  }

  return {
    oldValue: Object.keys(oldDiff).length > 0 ? oldDiff : null,
    newValue: Object.keys(newDiff).length > 0 ? newDiff : null,
  };
}

/**
 * Deep equality check for two values
 */
function isEqual(a: any, b: any): boolean {
  if (a === b) return true;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => isEqual(item, b[i]));
  }

  if (typeof a === 'object' && a !== null && b !== null) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => isEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Extract relevant fields from an entity for logging
 * Useful when you don't want to log the entire object
 */
export function pickFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[]
): Partial<T> {
  const picked: Partial<T> = {};

  for (const field of fields) {
    if (field in obj) {
      picked[field] = obj[field];
    }
  }

  return picked;
}

/**
 * Format an entity for human-readable display in audit log
 */
export function formatEntitySummary(
  entityType: string,
  entity: Record<string, any> | null
): string {
  if (!entity) return `${entityType} (unknown)`;

  // Try common identifier patterns
  const identifiers = ['email', 'name', 'title', 'code', 'itemDescription'];

  for (const identifier of identifiers) {
    if (entity[identifier]) {
      return `${entityType}: ${entity[identifier]}`;
    }
  }

  return `${entityType}: ${entity.id || 'unknown'}`;
}
