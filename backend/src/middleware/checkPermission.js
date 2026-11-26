/**
 * checkPermission.js — ESM middleware for role-based permission checks.
 *
 * Role resolution mirrors the frontend's fetchRole() in useAuth.tsx exactly:
 *   priority: super_admin > admin > manager > kitchen > chef > cashier >
 *             receptionist > staff > driver
 *   then falls back to roles[0], then null.
 *
 * hasPermission semantics:
 *   - null role      → false (must be authenticated)
 *   - role NOT in map → true  (unrestricted — manager/admin/staff/kitchen/driver unchanged)
 *   - role IN map    → check the allowed list (only receptionist is restricted)
 */

import { hasPermission } from '../lib/permissions.js';

/** Same priority order as useAuth.tsx fetchRole(). */
const ROLE_PRIORITY = [
  'super_admin',
  'admin',
  'manager',
  'kitchen',
  'chef',
  'cashier',
  'receptionist',
  'staff',
  'driver',
];

/**
 * Resolve the caller's effective role.
 * Uses req.user.roles (array from user_roles table, set by optionalAuth middleware).
 * If user_roles is empty, falls back to member_role from memberships.
 */
export function resolveRole(req) {
  const roles = req.user?.roles ?? [];
  const fromRoles = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? (roles[0] ?? null);
  if (fromRoles) return fromRoles;

  // Fall back: check member_role from memberships
  const memberships = req.user?.memberships ?? [];
  for (const priority of ROLE_PRIORITY) {
    if (memberships.some((m) => m.member_role === priority)) return priority;
  }
  return null;
}

/**
 * Express middleware factory.
 * Usage: router.post('/path', optionalAuth, requireAuth, checkPermission('some.permission'), handler)
 *
 * - If the resolved role has the permission → next()
 * - If not → 403
 */
export function checkPermission(permission) {
  return (req, res, next) => {
    const role = resolveRole(req);
    if (!hasPermission(role, permission)) {
      return res.status(403).json({ error: 'Forbidden – insufficient permissions' });
    }
    next();
  };
}
