import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, UserPlus, Trash2, ShieldCheck, Mail, Search, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  roles?: string[];
}

export function UserManagement() {
  const { t } = useTranslation(["settings", "common", "auth"]);
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("agent");

  const load = async () => {
    setLoading(true);
    try {
      const { data: pData, error: pError } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (pError) throw pError;

      const { data: rData, error: rError } = await supabase.from("user_roles").select("user_id, role");
      if (rError) throw rError;

      const profilesWithRoles = (pData as any[]).map((p: any) => ({
        ...p,
        roles: (rData as any[]).filter((r: any) => r.user_id === p.id).map((r: any) => r.role)
      }));

      setProfiles(profilesWithRoles);
    } catch (error: any) {
      toast({ variant: "destructive", title: t("common:error", "Error"), description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateUser = async () => {
    if (!email || !password) {
      toast({ variant: "destructive", title: t("settings:requiredFields", "Required fields"), description: t("settings:emailPasswordRequired", "Email and password are required.") });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await (supabase.auth as any).signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });

      if (error) throw error;

      if (data?.user?.id && role !== "admin") {
        await supabase.from("user_roles").update({ role }).eq("user_id", data.user.id);
      }

      toast({ title: t("settings:userCreatedSuccessfully", "User created successfully") });
      setOpen(false);
      setEmail("");
      setPassword("");
      setFullName("");
      setRole("agent");
      load();
    } catch (error: any) {
      toast({ variant: "destructive", title: t("common:failed", "Failed"), description: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("settings:confirmDeleteUser", "Are you sure you want to delete this user? This will remove their profile and roles."))) return;

    try {
      const { error } = await supabase.from("profiles").delete().eq("id", id);
      if (error) throw error;
      toast({ title: t("settings:userDeleted", "User deleted") });
      load();
    } catch (error: any) {
      toast({ variant: "destructive", title: t("settings:deleteFailed", "Delete failed"), description: error.message });
    }
  };

  const filteredProfiles = profiles.filter(p =>
    p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {t("settings:systemUsers", "System Users")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("settings:systemUsersDesc", "Manage accounts and permissions for your staff.")}</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" /> {t("settings:addNewUser", "Add New User")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings:createStaffAccount", "Create Staff Account")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("common:emailAddress", "Email Address")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("settings:initialPassword", "Initial Password")}</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("settings:minSixChars", "Minimum 6 characters")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t("auth:fullName", "Full Name")}</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <Label>{t("settings:systemRole", "System Role")}</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">{t("settings:roleSuperAdmin", "Super Admin")}</SelectItem>
                    <SelectItem value="admin">{t("settings:roleAdmin", "Admin")}</SelectItem>
                    <SelectItem value="manager">{t("settings:roleManager", "Manager")}</SelectItem>
                    <SelectItem value="agent">{t("settings:roleAgent", "Agent (Staff)")}</SelectItem>
                    <SelectItem value="driver">{t("settings:roleDriver", "Driver")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>{t("common:cancel", "Cancel")}</Button>
              <Button onClick={handleCreateUser} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t("settings:createAccount", "Create Account")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("settings:searchUsers", "Search users by name or email...")}
          className="pl-10 bg-card/50"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">{t("settings:loadingUsers", "Loading users...")}</div>
        ) : filteredProfiles.map((p) => (
          <Card key={p.id} className="rounded-2xl border border-border/80 shadow-xs overflow-hidden hover:border-border transition-colors">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    {p.full_name || t("settings:newUser", "New User")}
                    {p.roles?.map(r => (
                      <Badge key={r} variant="secondary" className="text-[9px] uppercase font-bold px-1.5 h-4">
                        {r.replace("_", " ")}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {p.email}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
