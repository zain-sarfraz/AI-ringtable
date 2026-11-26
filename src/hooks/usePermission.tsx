import { useAuth } from "@/hooks/useAuth";
import { hasPermission, rolePermissions } from "@/lib/permissions";

/**
 * Hook to check permissions for the current user role.
 * Returns a function that takes a permission string and returns a boolean.
 * Unknown roles (no mapping) are treated as having all permissions (no restriction).
 */
export function usePermission() {
    const { role } = useAuth();

    return (permission: string): boolean => {
        return hasPermission(role, permission);
    };
}
