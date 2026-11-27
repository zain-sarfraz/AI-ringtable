// Hard-coded permission map for the backend (temporary solution).
// Mirrors src/lib/permissions.ts on the frontend.
// ONLY roles listed here are restricted. Any unknown role is unrestricted (returns true).
// Backend uses ESM – export with `export const` / `export function`.

// Allow-list for roles with strict allowed-only capabilities (e.g. receptionist)
export const rolePermissions = {
  receptionist: [
    'dashboard.view_reception',
    'reservations.view',
    'reservations.create',
    'reservations.update',
    'reservations.cancel',
    'reservations.seat',
    'reservations.mark_noshow',
    'tables.view',
    'tables.update_status',
    'calls.view_for_booking',
    'profile.update',
    'waiting_list.manage',
    'walk_in.create',
  ],
};

// Deny-list for roles where everything is allowed by default UNLESS explicitly denied (e.g. manager)
export const roleDeniedPermissions = {
  manager: [
    'branches.create',
    'branches.delete',
    'admin_earnings.view',
    'staff.manage_admins',
  ],
};

/** Returns true if the role has the permission.
 *  Roles in roleDeniedPermissions use a deny-list (allowed unless explicitly denied).
 *  Roles in rolePermissions use an allow-list (denied unless explicitly allowed).
 *  Roles NOT listed anywhere are unrestricted (return true).
 */
export function hasPermission(role, permission) {
  if (role === null || role === undefined) return true; // null/undefined = unrestricted
  if (role in roleDeniedPermissions) {
    return !roleDeniedPermissions[role].includes(permission);
  }
  if (role in rolePermissions) {
    return rolePermissions[role].includes(permission);
  }
  return true; // unknown role (admin, kitchen, staff, etc.) = unrestricted
}
