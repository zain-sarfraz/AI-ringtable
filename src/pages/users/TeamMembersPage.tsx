import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/i18n/formatters";
import { supabase } from "@/integrations/supabase/client";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import {
    CalendarCheck,
    Check,
    ChefHat,
    Loader2,
    Lock,
    Mail,
    Pencil,
    Receipt,
    Search,
    Shield,
    ShieldCheck,
    Store,
    Trash2,
    User,
    UserCog,
    UserPlus,
    Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface TeamMemberRow {
    id: string; // restaurant_members.id
    restaurant_id: string;
    restaurant_name: string;
    user_id: string;
    member_role: string;
    email: string;
    full_name: string | null;
    created_at: string;
}

interface RestaurantOption {
    id: string;
    name: string;
}

export default function TeamMembersPage() {
    const { t } = useTranslation(["users", "common", "settings"]);
    const { toast } = useToast();
    const { user, role: authRole } = useAuth();
    const isSuperAdmin = authRole === "super_admin";
    const isRestaurantAdmin =
        authRole === "admin" || authRole === "super_admin";
    // Owner/admin and managers can add & manage team members
    const canManageMembers =
        authRole === "admin" ||
        authRole === "super_admin" ||
        authRole === "manager";
    const { restaurantId: activeRestaurantId } = useActiveRestaurant();

    const canDeleteMember = (row: TeamMemberRow) => {
        if (!canManageMembers) return false;
        if (row.member_role === "owner") return false;
        if (user?.id && row.user_id === user.id) return false;
        // Managers cannot remove admin/manager accounts
        if (
            authRole === "manager" &&
            (row.member_role === "admin" || row.member_role === "manager")
        ) {
            return false;
        }
        return true;
    };

    const [members, setMembers] = useState<TeamMemberRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    // Add Member Modal State
    const [openDialog, setOpenDialog] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const defaultNewMemberRole = authRole === "manager" ? "staff" : "manager";
    const [role, setRole] = useState(defaultNewMemberRole);
    const [editing, setEditing] = useState<TeamMemberRow | null>(null);
    const [editName, setEditName] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [editPassword, setEditPassword] = useState("");
    const [editRole, setEditRole] = useState("staff");
    const [editSubmitting, setEditSubmitting] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            if (isSuperAdmin) {
                // 1. Super Admin: Load Platform Team Members
                // Note: Do NOT use .in("role", [...]) — it causes a 400 via compatClient.
                // Instead, fetch all user_roles for super admin (backend bypasses scope for super_admin)
                // and filter on the frontend.
                const [
                    { data: rolesData, error: rErr },
                    { data: pData, error: pErr },
                ] = await Promise.all([
                    supabase.from("user_roles").select("user_id, role"),
                    supabase
                        .from("profiles")
                        .select("id, email, full_name, created_at")
                        .order("created_at", { ascending: false }),
                ]);

                if (rErr) throw rErr;
                if (pErr) throw pErr;

                // Platform team only — never list restaurant owners/staff here
                const platformRoleByUser = new Map<string, string>();
                for (const r of (rolesData as {
                    user_id: string;
                    role: string;
                }[]) || []) {
                    if (r.role === "super_admin" || r.role === "admin") {
                        const prev = platformRoleByUser.get(r.user_id);
                        if (!prev || r.role === "super_admin")
                            platformRoleByUser.set(r.user_id, r.role);
                    }
                }

                const { data: memberRows } = await supabase
                    .from("restaurant_members")
                    .select("user_id");
                const restaurantUserIds = new Set(
                    ((memberRows as { user_id: string }[]) || []).map(
                        (m) => m.user_id,
                    ),
                );

                const platformProfiles = ((pData as any[]) || []).filter(
                    (p) => {
                        const platformRole = platformRoleByUser.get(p.id);
                        if (!platformRole) return false;
                        // Exclude anyone who is only a restaurant tenant (has membership, not super_admin)
                        if (
                            platformRole !== "super_admin" &&
                            restaurantUserIds.has(p.id)
                        )
                            return false;
                        return true;
                    },
                );

                const combined: TeamMemberRow[] = platformProfiles.map((p) => ({
                    id: p.id,
                    restaurant_id: "",
                    restaurant_name: "Super Admin Portal",
                    user_id: p.id,
                    member_role: platformRoleByUser.get(p.id) || "admin",
                    email: p.email,
                    full_name: p.full_name,
                    created_at: p.created_at,
                }));

                setMembers(combined);
            } else {
                // 2. Restaurant Admin: Load only this restaurant's staff
                if (!activeRestaurantId) {
                    setMembers([]);
                    return;
                }

                const { data: mData, error: mErr } = await supabase
                    .from("restaurant_members")
                    .select(
                        "id, restaurant_id, user_id, member_role, created_at",
                    )
                    .eq("restaurant_id", activeRestaurantId)
                    .order("created_at", { ascending: false });

                if (mErr) throw mErr;
                const mRows = (mData as any[]) || [];

                const userIds = [
                    ...new Set(mRows.map((m) => m.user_id).filter(Boolean)),
                ];

                const [
                    { data: pData },
                    { data: restData },
                    { data: superRoles },
                ] = await Promise.all([
                    userIds.length > 0
                        ? supabase
                              .from("profiles")
                              .select("id, email, full_name")
                              .in("id", userIds)
                        : { data: [] },
                    supabase
                        .from("restaurants")
                        .select("name")
                        .eq("id", activeRestaurantId)
                        .maybeSingle(),
                    userIds.length > 0
                        ? supabase
                              .from("user_roles")
                              .select("user_id, role")
                              .in("user_id", userIds)
                              .eq("role", "super_admin")
                        : { data: [] },
                ]);

                const superAdminUserIds = new Set(
                    ((superRoles as any[]) || []).map((r) => r.user_id),
                );

                const profileMap = Object.fromEntries(
                    ((pData as any[]) || []).map((p) => [
                        p.id,
                        { email: p.email, full_name: p.full_name },
                    ]),
                );

                const rName = (restData as any)?.name || "Royal Restaurant";

                const combined: TeamMemberRow[] = mRows
                    .filter((m) => {
                        if (superAdminUserIds.has(m.user_id)) return false;
                        const prof = profileMap[m.user_id];
                        if (prof?.email?.toLowerCase() === "admin@admin.com")
                            return false;
                        return true;
                    })
                    .map((m) => {
                        const prof = profileMap[m.user_id] || {
                            email: "",
                            full_name: null,
                        };
                        return {
                            id: m.id,
                            restaurant_id: m.restaurant_id,
                            restaurant_name: rName,
                            user_id: m.user_id,
                            member_role: m.member_role || "staff",
                            email: prof.email,
                            full_name: prof.full_name,
                            created_at: m.created_at,
                        };
                    });

                setMembers(combined);
            }
        } catch (err: any) {
            console.error("Failed to load team members:", err);
            toast({
                variant: "destructive",
                title: t("common:error", "Error"),
                description: err.message,
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        setRole(authRole === "manager" ? "staff" : "manager");
    }, [activeRestaurantId, isSuperAdmin, authRole]);

    const handleCreateMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password.trim()) {
            toast({
                variant: "destructive",
                title: t("common:validationError", "Validation Error"),
                description: t(
                    "settings:emailPasswordRequired",
                    "Email and password are required.",
                ),
            });
            return;
        }

        if (!isSuperAdmin && !activeRestaurantId) {
            toast({
                variant: "destructive",
                title: t("common:validationError", "Validation Error"),
                description: "No active restaurant found.",
            });
            return;
        }

        setSubmitting(true);
        try {
            const token = getToken();
            const payload: Record<string, any> = {
                email: email.trim(),
                password: password.trim(),
                full_name: fullName.trim(),
                role,
            };

            if (!isSuperAdmin) {
                payload.restaurant_id = activeRestaurantId;
            }

            const res = await fetch(
                `${getApiBase()}/api/auth/create-team-member`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify(payload),
                },
            );

            const json = await res.json();
            if (!res.ok) {
                if (
                    json.code === "email_taken" ||
                    /email already taken/i.test(String(json.error || ""))
                ) {
                    throw new Error(
                        json.error ||
                            "Email already taken in this restaurant. Please change the email.",
                    );
                }
                throw new Error(json.error || "Failed to add team member");
            }

            toast({
                title: "✅ Team Member Added",
                description: `${fullName || email} is now added with ${role} permissions.`,
            });

            setOpenDialog(false);
            setFullName("");
            setEmail("");
            setPassword("");
            setRole(authRole === "manager" ? "staff" : "manager");
            loadData();
        } catch (err: any) {
            toast({
                variant: "destructive",
                title: t("common:failed", "Failed"),
                description: err.message,
            });
        } finally {
            setSubmitting(false);
        }
    };

    const openEdit = (row: TeamMemberRow) => {
        setEditing(row);
        setEditName(row.full_name || "");
        setEditEmail(row.email || "");
        setEditPassword("");
        setEditRole(row.member_role || "staff");
    };

    const handleEditMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editing) return;
        if (!editEmail.trim()) {
            toast({
                variant: "destructive",
                title: t("common:validationError", "Validation Error"),
                description: "Email is required.",
            });
            return;
        }
        if (editPassword && editPassword.length < 6) {
            toast({
                variant: "destructive",
                title: t("common:validationError", "Validation Error"),
                description: "Password must be at least 6 characters.",
            });
            return;
        }

        setEditSubmitting(true);
        try {
            const token = getToken();
            const res = await fetch(
                `${getApiBase()}/api/auth/update-team-member`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        id: editing.id,
                        full_name: editName.trim(),
                        email: editEmail.trim(),
                        password: editPassword.trim() || undefined,
                        member_role:
                            editing.member_role === "owner"
                                ? undefined
                                : editRole,
                    }),
                },
            );
            const json = await res.json();
            if (!res.ok) {
                if (
                    json.code === "email_taken" ||
                    /email already taken/i.test(String(json.error || ""))
                ) {
                    throw new Error(
                        json.error ||
                            "Email already taken in this restaurant. Please change the email.",
                    );
                }
                throw new Error(json.error || "Failed to update team member");
            }
            toast({ title: "Team member updated" });
            setEditing(null);
            loadData();
        } catch (err: any) {
            toast({
                variant: "destructive",
                title: t("common:failed", "Failed"),
                description: err.message,
            });
        } finally {
            setEditSubmitting(false);
        }
    };

    const handleDeleteMember = async (row: TeamMemberRow) => {
        if (!canDeleteMember(row)) {
            toast({
                variant: "destructive",
                title: t("common:error", "Error"),
                description:
                    row.member_role === "owner" ||
                    (user?.id && row.user_id === user.id)
                        ? "Owner cannot delete their own account."
                        : "You cannot remove this member.",
            });
            return;
        }
        if (
            !confirm(
                `Are you sure you want to remove ${row.full_name || row.email || "this member"}?`,
            )
        ) {
            return;
        }

        try {
            const token = getToken();
            const res = await fetch(
                `${getApiBase()}/api/auth/delete-team-member/${row.id}`,
                {
                    method: "DELETE",
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                },
            );

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Failed to remove member");
            }

            toast({ title: "Team Member Removed" });
            loadData();
        } catch (err: any) {
            toast({
                variant: "destructive",
                title: t("common:error", "Error"),
                description: err.message,
            });
        }
    };

    const handleUpdateRole = async (membershipId: string, newRole: string) => {
        try {
            const token = getToken();
            const res = await fetch(
                `${getApiBase()}/api/auth/update-team-member-role`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        id: membershipId,
                        member_role: newRole,
                    }),
                },
            );

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Failed to update role");
            }

            toast({ title: "Role updated successfully" });
            loadData();
        } catch (err: any) {
            toast({
                variant: "destructive",
                title: t("common:error", "Error"),
                description: err.message,
            });
        }
    };

    const filteredMembers = useMemo(() => {
        return members.filter((m) => {
            const matchSearch =
                !searchQuery.trim() ||
                m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (m.full_name &&
                    m.full_name
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())) ||
                m.member_role.toLowerCase().includes(searchQuery.toLowerCase());

            return matchSearch;
        });
    }, [members, searchQuery]);

    const getRoleBadge = (roleStr: string) => {
        const r = roleStr.toLowerCase();
        if (r === "super_admin") {
            return (
                <Badge className="bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 gap-1 font-semibold">
                    <ShieldCheck className="h-3 w-3" />{" "}
                    {t("users:roleSuperAdmin", "Super Admin")}
                </Badge>
            );
        }
        if (r === "owner") {
            return (
                <Badge className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 gap-1 font-semibold">
                    <ShieldCheck className="h-3 w-3" />{" "}
                    {t("users:roleOwner", "Owner")}
                </Badge>
            );
        }
        if (r === "admin") {
            return (
                <Badge className="bg-primary/10 text-primary border-primary/30 gap-1 font-semibold">
                    <Shield className="h-3 w-3" />{" "}
                    {t("users:roleAdmin", "Admin")}
                </Badge>
            );
        }
        if (r === "manager") {
            return (
                <Badge className="bg-primary/10 text-primary border-primary/30 gap-1 font-semibold">
                    <Shield className="h-3 w-3" />{" "}
                    {t("users:roleManager", "Manager")}
                </Badge>
            );
        }
        if (r === "kitchen" || r === "chef") {
            return (
                <Badge className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 gap-1">
                    <ChefHat className="h-3 w-3" />{" "}
                    {t("users:roleKitchen", "Kitchen Staff")}
                </Badge>
            );
        }
        if (r === "receptionist") {
            return (
                <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 gap-1 font-semibold">
                    <CalendarCheck className="h-3 w-3" />{" "}
                    {t("users:roleReceptionist", "Receptionist")}
                </Badge>
            );
        }
        if (r === "staff") {
            return (
                <Badge className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 gap-1 font-semibold">
                    <UserCog className="h-3 w-3" />{" "}
                    {t("users:roleStaff", "Staff")}
                </Badge>
            );
        }
        if (r === "cashier") {
            return (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1">
                    <Receipt className="h-3 w-3" />{" "}
                    {t("users:roleCashier", "Cashier")}
                </Badge>
            );
        }
        return (
            <Badge variant="outline" className="capitalize font-semibold">
                {r || "Staff"}
            </Badge>
        );
    };

    return (
        <PageShell maxWidth="lg" className="min-w-0">
            <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-11 sm:w-11">
                        <Users className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 space-y-1">
                        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                            {t("users:teamMembersTitle", "Team Members")}
                        </h1>
                        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                            {t(
                                "users:teamMembersSubtitle",
                                "Manage restaurant staff and team members with access to edit restaurant menu, orders, inventory and settings.",
                            )}
                        </p>
                    </div>
                </div>

                {canManageMembers ? (
                    <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                        <DialogTrigger asChild>
                            <Button className="h-10 w-full gap-2 rounded-xl font-semibold gradient-primary text-primary-foreground shadow-sm sm:w-auto sm:self-start lg:shrink-0">
                                <UserPlus className="h-4 w-4 shrink-0" />
                                {t("users:addTeamMember", "Add Team Member")}
                            </Button>
                        </DialogTrigger>

                        <DialogContent className="max-w-md rounded-2xl">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2 text-lg">
                                    <UserPlus className="h-5 w-5 text-primary" />
                                    {t(
                                        "users:addTeamMember",
                                        "Add Team Member",
                                    )}
                                </DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground">
                                    {t(
                                        "users:addTeamMemberDesc",
                                        "Add staff members to collaborate on restaurant operations.",
                                    )}
                                </DialogDescription>
                            </DialogHeader>

                            <form
                                data-slot="dialog-form"
                                onSubmit={handleCreateMember}
                                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                            >
                                <DialogBody className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="mem-name"
                                            className="text-xs font-semibold"
                                        >
                                            {t("common:name", "Full Name")}
                                        </Label>
                                        <Input
                                            id="mem-name"
                                            placeholder="e.g. John Doe"
                                            value={fullName}
                                            onChange={(e) =>
                                                setFullName(e.target.value)
                                            }
                                            className="rounded-xl text-xs"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="mem-email"
                                            className="text-xs font-semibold"
                                        >
                                            {t("common:email", "Email Address")}{" "}
                                            <span className="text-destructive">
                                                *
                                            </span>
                                        </Label>
                                        <Input
                                            id="mem-email"
                                            type="email"
                                            placeholder="john@restaurant.com"
                                            value={email}
                                            onChange={(e) =>
                                                setEmail(e.target.value)
                                            }
                                            required
                                            className="rounded-xl text-xs"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="mem-pass"
                                            className="text-xs font-semibold"
                                        >
                                            {t("auth:password", "Password")}{" "}
                                            <span className="text-destructive">
                                                *
                                            </span>
                                        </Label>
                                        <Input
                                            id="mem-pass"
                                            type="password"
                                            placeholder="Minimum 6 characters"
                                            value={password}
                                            onChange={(e) =>
                                                setPassword(e.target.value)
                                            }
                                            required
                                            minLength={6}
                                            className="rounded-xl text-xs"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold">
                                            {t(
                                                "users:role",
                                                "Member Role & Permissions",
                                            )}
                                        </Label>
                                        <Select
                                            value={role}
                                            onValueChange={setRole}
                                        >
                                            <SelectTrigger className="rounded-xl text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {isRestaurantAdmin && (
                                                    <SelectItem value="admin">
                                                        {t(
                                                            "users:roleOptionAdmin",
                                                            "Admin (All modules)",
                                                        )}
                                                    </SelectItem>
                                                )}
                                                {isRestaurantAdmin && (
                                                    <SelectItem value="manager">
                                                        {t(
                                                            "users:roleOptionManager",
                                                            "Manager (Operations, Menu, Orders & Inventory)",
                                                        )}
                                                    </SelectItem>
                                                )}
                                                <SelectItem value="kitchen">
                                                    {t(
                                                        "users:roleOptionKitchen",
                                                        "Kitchen Staff (Order Fulfillment)",
                                                    )}
                                                </SelectItem>
                                                <SelectItem value="receptionist">
                                                    {t(
                                                        "users:roleOptionReceptionist",
                                                        "Receptionist (Table Reservations & Guest Check-in)",
                                                    )}
                                                </SelectItem>
                                                <SelectItem value="staff">
                                                    {t(
                                                        "users:roleOptionStaff",
                                                        "Staff (Table orders, menu, deals, reports)",
                                                    )}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="pt-1 text-[11px] text-muted-foreground">
                                            {t(
                                                "users:teamMembersHelpText",
                                                "Team members will have full rights to manage and modify this restaurant's operations.",
                                            )}
                                        </p>
                                    </div>
                                </DialogBody>

                                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                                    <Button
                                        variant="outline"
                                        type="button"
                                        className="w-full sm:w-auto"
                                        onClick={() => setOpenDialog(false)}
                                    >
                                        {t("common:cancel", "Cancel")}
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={submitting}
                                        className="w-full gap-2 gradient-primary text-primary-foreground sm:w-auto sm:min-w-[120px]"
                                    >
                                        {submitting ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Check className="h-4 w-4" />
                                        )}
                                        {submitting
                                            ? t("common:saving", "Saving...")
                                            : t(
                                                  "users:addTeamMember",
                                                  "Add Member",
                                              )}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                ) : null}
            </header>

            {/* Filter and Search Bar */}
            <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="relative w-full min-w-0 max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder={
                            isSuperAdmin
                                ? t(
                                      "users:searchPlatformTeamPlaceholder",
                                      "Search platform team by name, email, or role...",
                                  )
                                : t(
                                      "users:searchTeamPlaceholder",
                                      "Search by name, email, or role...",
                                  )
                        }
                        className="rounded-xl pl-9 text-xs"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* Members list */}
            <Card className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 bg-muted/10 px-4 py-3.5 sm:px-6 sm:py-4">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-bold">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">
                            {isSuperAdmin
                                ? t(
                                      "users:platformTeamMembers",
                                      "Platform Team Members",
                                  )
                                : t(
                                      "users:activeTeamMembers",
                                      "Active Team Members",
                                  )}{" "}
                            ({filteredMembers.length})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <span>
                                {t(
                                    "users:loadingTeamMembers",
                                    "Loading team members...",
                                )}
                            </span>
                        </div>
                    ) : filteredMembers.length === 0 ? (
                        <div className="space-y-2 py-16 text-center text-muted-foreground">
                            <Users className="mx-auto h-10 w-10 text-muted-foreground/30" />
                            <p className="text-sm font-semibold">
                                {t(
                                    "users:noTeamMembersFound",
                                    "No team members found",
                                )}
                            </p>
                            <p className="text-xs">
                                {t(
                                    "users:noTeamMembersSub",
                                    'Click "Add Member" above to grant access.',
                                )}
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Mobile / tablet cards */}
                            <div className="space-y-3 p-3 md:hidden">
                                {filteredMembers.map((row) => {
                                    const canEditRow =
                                        canManageMembers &&
                                        !(
                                            authRole === "manager" &&
                                            (row.member_role === "admin" ||
                                                row.member_role === "manager" ||
                                                row.user_id === user?.id)
                                        );
                                    const canSwitchRole =
                                        canEditRow &&
                                        row.member_role !== "owner";

                                    return (
                                        <div
                                            key={row.id}
                                            className="rounded-xl border border-border/70 bg-muted/10 p-3.5"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                                    {(
                                                        row.full_name ||
                                                        row.email ||
                                                        "U"
                                                    )
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <p className="truncate text-sm font-bold text-foreground">
                                                        {row.full_name ||
                                                            "Team Member"}
                                                    </p>
                                                    <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
                                                        <Mail className="h-3 w-3 shrink-0" />
                                                        <span className="truncate">
                                                            {row.email}
                                                        </span>
                                                    </p>
                                                    {!isSuperAdmin ? (
                                                        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                                                            <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                            <span className="truncate">
                                                                {
                                                                    row.restaurant_name
                                                                }
                                                            </span>
                                                        </p>
                                                    ) : null}
                                                </div>
                                                {canManageMembers ? (
                                                    <div className="flex shrink-0 items-center gap-0.5">
                                                        {canEditRow ? (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 rounded-lg"
                                                                title="Edit team member"
                                                                onClick={() =>
                                                                    openEdit(
                                                                        row,
                                                                    )
                                                                }
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                        ) : null}
                                                        {canDeleteMember(
                                                            row,
                                                        ) ? (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10"
                                                                title="Remove Team Member"
                                                                onClick={() =>
                                                                    handleDeleteMember(
                                                                        row,
                                                                    )
                                                                }
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 cursor-not-allowed rounded-lg opacity-40"
                                                                disabled
                                                                title={
                                                                    row.member_role ===
                                                                    "owner"
                                                                        ? "Owner cannot be removed"
                                                                        : "You cannot delete your own account"
                                                                }
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>

                                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                                                {getRoleBadge(row.member_role)}
                                                {canSwitchRole ? (
                                                    <Select
                                                        defaultValue={
                                                            row.member_role
                                                        }
                                                        onValueChange={(v) =>
                                                            handleUpdateRole(
                                                                row.id,
                                                                v,
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger className="h-8 w-full max-w-[11rem] border-border/50 bg-background text-xs sm:w-32">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {isRestaurantAdmin && (
                                                                <SelectItem value="admin">
                                                                    {t(
                                                                        "users:roleAdmin",
                                                                        "Admin",
                                                                    )}
                                                                </SelectItem>
                                                            )}
                                                            {isRestaurantAdmin && (
                                                                <SelectItem value="manager">
                                                                    {t(
                                                                        "users:roleManager",
                                                                        "Manager",
                                                                    )}
                                                                </SelectItem>
                                                            )}
                                                            <SelectItem value="kitchen">
                                                                {t(
                                                                    "users:roleKitchen",
                                                                    "Kitchen",
                                                                )}
                                                            </SelectItem>
                                                            <SelectItem value="receptionist">
                                                                {t(
                                                                    "users:roleReceptionist",
                                                                    "Receptionist",
                                                                )}
                                                            </SelectItem>
                                                            <SelectItem value="staff">
                                                                {t(
                                                                    "users:roleStaff",
                                                                    "Staff",
                                                                )}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                ) : null}
                                                <span className="ml-auto text-[11px] text-muted-foreground">
                                                    {formatDate(
                                                        row.created_at,
                                                        {
                                                            month: "short",
                                                            day: "numeric",
                                                            year: "numeric",
                                                        },
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Desktop table */}
                            <div className="hidden min-w-0 md:block">
                                <div className="overflow-x-auto">
                                    <Table className="min-w-[720px]">
                                        <TableHeader>
                                            <TableRow className="border-b border-border/50 bg-muted/30 hover:bg-muted/30">
                                                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-foreground sm:px-6">
                                                    {t(
                                                        "users:colMember",
                                                        "Member",
                                                    )}
                                                </TableHead>
                                                {!isSuperAdmin && (
                                                    <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                                        {t(
                                                            "users:colRestaurant",
                                                            "Restaurant",
                                                        )}
                                                    </TableHead>
                                                )}
                                                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                                    {t(
                                                        "users:colRolePermissions",
                                                        "Role & Permissions",
                                                    )}
                                                </TableHead>
                                                <TableHead className="whitespace-nowrap px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                                    {t(
                                                        "users:colDateAdded",
                                                        "Date Added",
                                                    )}
                                                </TableHead>
                                                {canManageMembers && (
                                                    <TableHead className="px-4 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground sm:px-6">
                                                        {t(
                                                            "users:colActions",
                                                            "Actions",
                                                        )}
                                                    </TableHead>
                                                )}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="divide-y divide-border/40">
                                            {filteredMembers.map((row) => (
                                                <TableRow
                                                    key={row.id}
                                                    className="transition-colors hover:bg-muted/20"
                                                >
                                                    <TableCell className="px-4 py-4 sm:px-6">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                                                {(
                                                                    row.full_name ||
                                                                    row.email ||
                                                                    "U"
                                                                )
                                                                    .charAt(0)
                                                                    .toUpperCase()}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="truncate text-xs font-bold text-foreground">
                                                                    {row.full_name ||
                                                                        "Team Member"}
                                                                </p>
                                                                <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                                                                    <Mail className="h-3 w-3 shrink-0" />
                                                                    {row.email}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </TableCell>

                                                    {!isSuperAdmin && (
                                                        <TableCell className="px-4 py-4">
                                                            <div className="flex max-w-[12rem] items-center gap-1.5 text-xs font-semibold text-foreground">
                                                                <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                                <span className="truncate">
                                                                    {
                                                                        row.restaurant_name
                                                                    }
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                    )}

                                                    <TableCell className="px-4 py-4">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            {getRoleBadge(
                                                                row.member_role,
                                                            )}
                                                            {canManageMembers &&
                                                                row.member_role !==
                                                                    "owner" &&
                                                                !(
                                                                    authRole ===
                                                                        "manager" &&
                                                                    (row.member_role ===
                                                                        "admin" ||
                                                                        row.member_role ===
                                                                            "manager" ||
                                                                        row.user_id ===
                                                                            user?.id)
                                                                ) && (
                                                                    <Select
                                                                        defaultValue={
                                                                            row.member_role
                                                                        }
                                                                        onValueChange={(
                                                                            v,
                                                                        ) =>
                                                                            handleUpdateRole(
                                                                                row.id,
                                                                                v,
                                                                            )
                                                                        }
                                                                    >
                                                                        <SelectTrigger className="h-6 w-24 border-border/50 bg-background/50 text-[10px]">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {isRestaurantAdmin && (
                                                                                <SelectItem value="admin">
                                                                                    {t(
                                                                                        "users:roleAdmin",
                                                                                        "Admin",
                                                                                    )}
                                                                                </SelectItem>
                                                                            )}
                                                                            {isRestaurantAdmin && (
                                                                                <SelectItem value="manager">
                                                                                    {t(
                                                                                        "users:roleManager",
                                                                                        "Manager",
                                                                                    )}
                                                                                </SelectItem>
                                                                            )}
                                                                            <SelectItem value="kitchen">
                                                                                {t(
                                                                                    "users:roleKitchen",
                                                                                    "Kitchen",
                                                                                )}
                                                                            </SelectItem>
                                                                            <SelectItem value="receptionist">
                                                                                {t(
                                                                                    "users:roleReceptionist",
                                                                                    "Receptionist",
                                                                                )}
                                                                            </SelectItem>
                                                                            <SelectItem value="staff">
                                                                                {t(
                                                                                    "users:roleStaff",
                                                                                    "Staff",
                                                                                )}
                                                                            </SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                )}
                                                        </div>
                                                    </TableCell>

                                                    <TableCell className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">
                                                        {formatDate(
                                                            row.created_at,
                                                            {
                                                                month: "short",
                                                                day: "numeric",
                                                                year: "numeric",
                                                            },
                                                        )}
                                                    </TableCell>

                                                    {canManageMembers && (
                                                        <TableCell className="px-4 py-4 text-right sm:px-6">
                                                            <div className="inline-flex items-center justify-end gap-1">
                                                                {!(
                                                                    authRole ===
                                                                        "manager" &&
                                                                    (row.member_role ===
                                                                        "admin" ||
                                                                        row.member_role ===
                                                                            "manager" ||
                                                                        row.user_id ===
                                                                            user?.id)
                                                                ) && (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 rounded-lg"
                                                                        title="Edit team member"
                                                                        onClick={() =>
                                                                            openEdit(
                                                                                row,
                                                                            )
                                                                        }
                                                                    >
                                                                        <Pencil className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                                {canDeleteMember(
                                                                    row,
                                                                ) ? (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10"
                                                                        title="Remove Team Member"
                                                                        onClick={() =>
                                                                            handleDeleteMember(
                                                                                row,
                                                                            )
                                                                        }
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 cursor-not-allowed rounded-lg opacity-40"
                                                                        title={
                                                                            row.member_role ===
                                                                            "owner"
                                                                                ? "Owner cannot be removed"
                                                                                : "You cannot delete your own account"
                                                                        }
                                                                        disabled
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={!!editing}
                onOpenChange={(open) => !open && setEditing(null)}
            >
                <DialogContent className="max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <Pencil className="h-5 w-5 text-primary" />
                            Edit team member
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Update the name, email, password, or role. Leave the
                            password blank to keep the current one.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        data-slot="dialog-form"
                        onSubmit={handleEditMember}
                        className="flex min-h-0 flex-1 flex-col overflow-hidden"
                    >
                        <DialogBody className="space-y-4">
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="edit-name"
                                    className="text-xs font-semibold"
                                >
                                    Name
                                </Label>
                                <Input
                                    id="edit-name"
                                    value={editName}
                                    onChange={(e) =>
                                        setEditName(e.target.value)
                                    }
                                    className="rounded-xl text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="edit-email"
                                    className="text-xs font-semibold"
                                >
                                    Email{" "}
                                    <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    id="edit-email"
                                    type="email"
                                    required
                                    value={editEmail}
                                    onChange={(e) =>
                                        setEditEmail(e.target.value)
                                    }
                                    className="rounded-xl text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="edit-pass"
                                    className="text-xs font-semibold"
                                >
                                    New password
                                </Label>
                                <Input
                                    id="edit-pass"
                                    type="password"
                                    placeholder="Leave blank to keep the current password"
                                    value={editPassword}
                                    onChange={(e) =>
                                        setEditPassword(e.target.value)
                                    }
                                    className="rounded-xl text-xs"
                                />
                            </div>
                            {editing?.member_role !== "owner" && (
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">
                                        Role
                                    </Label>
                                    <Select
                                        value={editRole}
                                        onValueChange={setEditRole}
                                    >
                                        <SelectTrigger className="rounded-xl text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {isRestaurantAdmin && (
                                                <SelectItem value="admin">
                                                    Admin (All modules)
                                                </SelectItem>
                                            )}
                                            {isRestaurantAdmin && (
                                                <SelectItem value="manager">
                                                    Manager
                                                </SelectItem>
                                            )}
                                            <SelectItem value="kitchen">
                                                Kitchen Staff
                                            </SelectItem>
                                            <SelectItem value="receptionist">
                                                Receptionist
                                            </SelectItem>
                                            <SelectItem value="staff">
                                                Staff
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </DialogBody>
                        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                            <Button
                                variant="outline"
                                type="button"
                                className="w-full sm:w-auto"
                                onClick={() => setEditing(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={editSubmitting}
                                className="w-full gap-2 gradient-primary text-primary-foreground sm:w-auto"
                            >
                                {editSubmitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="h-4 w-4" />
                                )}
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
