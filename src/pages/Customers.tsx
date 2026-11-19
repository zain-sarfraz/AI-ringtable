import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Mail, Phone, Building2, TrendingUp, Plus, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { cn } from "@/lib/utils";
import { formatDate } from "@/i18n/formatters";
import { PageShell } from "@/components/layout/PageShell";

const AVATAR_TONES = [
  "bg-orange-100 text-orange-800",
  "bg-amber-100 text-amber-800",
  "bg-stone-200 text-stone-700",
  "bg-slate-200 text-slate-700",
  "bg-rose-100 text-rose-800",
  "bg-yellow-100 text-yellow-800",
];

function avatarTone(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i) * (i + 1)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash];
}

const CARD_SHADOW =
  "overflow-hidden rounded-2xl border border-border/80 shadow-xs";

export default function Customers() {
  const { t } = useTranslation(["users", "common"]);
  const { toast } = useToast();
  const { restaurantId } = useActiveRestaurant();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newNotes, setNewNotes] = useState("");

  function resetAddForm() {
    setNewFullName("");
    setNewEmail("");
    setNewPhone("");
    setNewCompany("");
    setNewNotes("");
  }

  const addCustomer = useMutation({
    mutationFn: async () => {
      const phone = newPhone.trim();
      if (!phone) {
        throw new Error(t("users:phoneRequired", "Phone number is required."));
      }
      const { error } = await supabase.from("customers").insert({
        phone_number: phone,
        full_name: newFullName.trim() || null,
        email: newEmail.trim() || null,
        company: newCompany.trim() || null,
        notes: newNotes.trim() || null,
        ...(restaurantId ? { restaurant_id: restaurantId } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: t("users:customerAdded", "Customer added") });
      setAddOpen(false);
      resetAddForm();
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: t("common:error", "Could not add customer"),
        description: err.message,
      });
    },
  });

  // Fetch customers from the customers table
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["customers", restaurantId],
    queryFn: async () => {
      let q = supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });
      if (restaurantId) {
        q = q.eq("restaurant_id", restaurantId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch won leads to display alongside customers
  const { data: wonLeads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["leads-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .in("status", ["won", "qualified"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const wonOnly = wonLeads.filter((l) => l.status === "won");

  const allCustomers = [
    ...customers.map((c) => ({
      id: c.id,
      full_name: c.full_name || "Unknown",
      email: c.email,
      phone_number: c.phone_number,
      company: c.company,
      source: "direct" as const,
      status: "won" as const,
      created_at: c.created_at,
    })),
    ...wonLeads.map((l) => ({
      id: l.id,
      full_name: l.full_name || "Unknown",
      email: l.email,
      phone_number: l.phone_number,
      company: l.company,
      source: l.status === "won" ? ("converted_lead" as const) : ("potential" as const),
      status: (l.status || "qualified") as string,
      created_at: l.created_at,
    })),
  ];

  const filteredCustomers = allCustomers.filter((customer) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      customer.full_name?.toLowerCase().includes(query) ||
      customer.email?.toLowerCase().includes(query) ||
      customer.phone_number?.toLowerCase().includes(query) ||
      customer.company?.toLowerCase().includes(query)
    );
  });

  const isLoading = customersLoading || leadsLoading;
  const convertedCount = wonOnly.length;
  const potentialCount = wonLeads.length - wonOnly.length;

  return (
    <PageShell className="space-y-5 sm:space-y-6">
      {/* Hero band */}
      <section className="relative overflow-hidden rounded-2xl gradient-hero text-primary-foreground shadow-[0_20px_48px_-18px_rgba(249,115,22,0.45),0_8px_20px_-10px_rgba(31,41,55,0.5)] animate-rise">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 18%, rgba(249,115,22,0.35) 0, transparent 42%), radial-gradient(circle at 88% 12%, rgba(251,191,36,0.22) 0, transparent 38%), linear-gradient(135deg, transparent 38%, rgba(0,0,0,0.28) 100%)",
          }}
        />
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("users:customersTitle", "Customers")}</h1>
            <p className="max-w-xl text-sm text-white/75">{t("users:customersSubtitle", "View customers and converted leads")}</p>
          </div>
          <Button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full shrink-0 rounded-lg bg-white text-foreground shadow-xs hover:bg-white/90 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" aria-hidden />
            {t("users:addCustomer", "Add customer")}
          </Button>
        </div>
      </section>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddForm();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight">{t("users:addCustomer", "Add customer")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 pb-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cust-phone">{t("common:phone", "Phone number")} *</Label>
                <Input
                  id="cust-phone"
                  placeholder="+1 555 0100"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  autoComplete="tel"
                  className="rounded-lg"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cust-name">{t("common:name", "Full name")}</Label>
                <Input
                  id="cust-name"
                  placeholder="Jane Doe"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cust-email">{t("common:email", "Email")}</Label>
                <Input
                  id="cust-email"
                  type="email"
                  placeholder="jane@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="rounded-lg"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cust-company">{t("users:colCompany", "Company")}</Label>
                <Input
                  id="cust-company"
                  placeholder="Acme Inc."
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="rounded-lg"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cust-notes">{t("users:notes", "Notes")}</Label>
              <Textarea
                id="cust-notes"
                placeholder={t("users:notesPlaceholder", "Optional notes…")}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
                className="rounded-lg"
              />
            </div>
          </div>
          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setAddOpen(false);
                resetAddForm();
              }}
            >
              {t("common:cancel", "Cancel")}
            </Button>
            <Button
              type="button"
              className="rounded-lg"
              disabled={addCustomer.isPending}
              onClick={() => addCustomer.mutate()}
            >
              {addCustomer.isPending ? t("common:saving", "Saving…") : t("users:saveCustomer", "Save customer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className={CARD_SHADOW}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-8 w-16" />
                    </div>
                    <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <StatsCard
              title={t("users:statTotalCustomers", "Total Customers")}
              value={allCustomers.length}
              icon={Users}
              iconClassName="bg-orange-50 text-orange-700"
            />
            <StatsCard
              title={t("users:statDirectCustomers", "Direct Customers")}
              value={customers.length}
              icon={UserPlus}
              iconClassName="bg-amber-50 text-amber-800"
            />
            <StatsCard
              title={t("users:statConvertedLeads", "Converted Leads")}
              value={convertedCount}
              icon={TrendingUp}
              iconClassName="bg-emerald-50 text-emerald-700"
            />
            <StatsCard
              title={t("users:statPotentialQualified", "Potential (qualified)")}
              value={potentialCount}
              icon={TrendingUp}
              iconClassName="bg-slate-100 text-slate-700"
            />
          </>
        )}
      </div>

      {/* Customers table */}
      <Card className={cn(CARD_SHADOW, "overflow-hidden")}>
        <CardHeader className="flex flex-col gap-4 space-y-0 border-b border-border/80 bg-muted/30 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base font-bold tracking-tight">{t("users:allCustomers", "All Customers")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {filteredCustomers.length}{" "}
              {filteredCustomers.length === 1 ? t("users:record", "record") : t("users:records", "records")}
              {searchQuery ? ` ${t("users:matchingSearch", "matching your search")}` : ""}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder={t("users:searchCustomersPlaceholder", "Search customers...")}
              className="rounded-lg border-border/80 bg-muted/30 pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 m-5 px-4 py-12 text-center">
              <Users className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t("users:noCustomersFound", "No customers found")}</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                {t("users:noCustomersSub", "Add a customer with the button above, or convert leads to see them here.")}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-4 rounded-lg"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t("users:addCustomer", "Add customer")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/60">
                    <TableHead className="pl-5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t("users:colCustomer", "Customer")}
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t("users:colContact", "Contact")}
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t("users:colCompany", "Company")}
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t("users:colSource", "Source")}
                    </TableHead>
                    <TableHead className="pr-5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t("users:colAdded", "Added")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer border-border/50 transition-colors hover:bg-muted/70"
                    >
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 rounded-lg">
                            <AvatarFallback
                              className={cn(
                                "rounded-lg text-sm font-bold",
                                avatarTone(customer.full_name || "?")
                              )}
                            >
                              {customer.full_name
                                ?.split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2) || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-semibold text-foreground">{customer.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {customer.email && (
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              <span className="truncate">{customer.email}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {customer.phone_number || "—"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {customer.company ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            {customer.company}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-md border font-medium",
                            customer.source === "converted_lead"
                              ? "bg-primary/12 text-primary border-primary/25 hover:bg-primary/12"
                              : customer.source === "potential"
                                ? "bg-amber-50 text-amber-800 border-amber-200/80 hover:bg-amber-50"
                                : "bg-slate-100 text-slate-800 border-slate-200/80 hover:bg-slate-100"
                          )}
                        >
                          {customer.source === "converted_lead"
                            ? t("users:convertedLead", "Converted Lead")
                            : customer.source === "potential"
                              ? `${t("users:potential", "Potential")} (${customer.status})`
                              : t("users:direct", "Direct")}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5 text-sm text-muted-foreground tabular-nums">
                        {customer.created_at
                          ? formatDate(customer.created_at, { month: "short", day: "numeric", year: "numeric" })
                          : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
