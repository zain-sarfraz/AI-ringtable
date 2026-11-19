import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Crown, Loader2, Search, Store, Mail, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/i18n/formatters";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

type MemberRow = {
  id: string;
  restaurant_id: string;
  user_id: string;
  member_role: string;
  created_at: string;
};

type OwnerRow = MemberRow & {
  restaurant_name: string;
  owner_email: string;
  owner_full_name: string | null;
};

async function loadOwners(): Promise<OwnerRow[]> {
  const { data: members, error: mErr } = await supabase
    .from("restaurant_members")
    .select("id, restaurant_id, user_id, member_role, created_at")
    .eq("member_role", "owner")
    .order("created_at", { ascending: false });
  if (mErr) throw mErr;
  const mrows = (members as MemberRow[]) ?? [];
  if (!mrows.length) return [];

  const restaurantIds = [...new Set(mrows.map((m) => m.restaurant_id))];
  const userIds = [...new Set(mrows.map((m) => m.user_id))];

  const [{ data: restaurants }, { data: profiles }] = await Promise.all([
    supabase.from("restaurants").select("id, name").in("id", restaurantIds),
    supabase.from("profiles").select("id, email, full_name").in("id", userIds),
  ]);

  const nameByRestaurant = Object.fromEntries(
    ((restaurants as { id: string; name: string }[]) ?? []).map((r) => [r.id, r.name])
  );
  const profileByUser = Object.fromEntries(
    ((profiles as { id: string; email: string; full_name: string | null }[]) ?? []).map((p) => [
      p.id,
      { email: p.email ?? "", full_name: p.full_name },
    ])
  );

  return mrows.map((m) => {
    const prof = profileByUser[m.user_id] ?? { email: "", full_name: null as string | null };
    return {
      ...m,
      restaurant_name: nameByRestaurant[m.restaurant_id] ?? "Unknown restaurant",
      owner_email: prof.email,
      owner_full_name: prof.full_name,
    };
  });
}

export default function RestaurantOwnersPage() {
  const { t } = useTranslation(["users", "common"]);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["restaurant-owners"],
    queryFn: loadOwners,
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.restaurant_name.toLowerCase().includes(q) ||
        (r.owner_email && r.owner_email.toLowerCase().includes(q)) ||
        (r.owner_full_name && r.owner_full_name.toLowerCase().includes(q))
    );
  }, [rows, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <p className="font-bold">{t("common:error", "Error loading restaurant owners")}</p>
        <p className="text-sm">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <PageShell maxWidth="lg">
      <PageHeader
        icon={<Crown className="h-5 w-5" />}
        title={t("users:restaurantOwnersTitle", "Restaurant owners")}
        description={t("users:restaurantOwnersSubtitle", "Profiles linked as owner on each restaurant")}
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("users:searchOwnersPlaceholder", "Search by restaurant, name, or email…")}
              className="pl-9 rounded-xl"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        }
      />

      <Card className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-lg">{t("users:allOwnerMemberships", "All owner memberships")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("users:colRestaurant", "Restaurant")}</TableHead>
                  <TableHead>{t("users:colOwner", "Owner")}</TableHead>
                  <TableHead>{t("common:email", "Email")}</TableHead>
                  <TableHead className="text-right">{t("users:colLinked", "Linked")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <Store className="h-4 w-4 text-muted-foreground shrink-0" />
                        {row.restaurant_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        {row.owner_full_name || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4 shrink-0" />
                        {row.owner_email || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {row.created_at ? formatDate(row.created_at, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                      {rows.length === 0
                        ? t("users:noOwnersFound", "No restaurant owners found.")
                        : t("common:noMatchingResults", "No rows match your search.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

