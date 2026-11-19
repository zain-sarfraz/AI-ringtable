import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import {
  User,
  Mail,
  Save,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  Shield,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

function roleLabel(role: string | null | undefined) {
  if (!role) return "User";
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function Profile() {
  const { t } = useTranslation(["auth", "common"]);
  const { user, profile, role, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [avatarData, setAvatarData] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setAvatarData(profile.avatar_url || "");
    }
  }, [profile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: t("common:error", "File too large"),
        description: "Please select an image smaller than 2MB.",
      });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setAvatarData(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          avatar_url: avatarData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;

      toast({ title: t("auth:profileUpdated", "Profile updated"), description: "Your details were saved." });
      await refreshProfile();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: t("common:error", "Update failed"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({
        variant: "destructive",
        title: t("common:error", "Weak password"),
        description: "New password must be at least 8 characters.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: t("common:error", "Password mismatch"),
        description: "New password and confirmation do not match.",
      });
      return;
    }

    setPasswordBusy(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Password change failed");
      }

      toast({
        title: t("auth:passwordUpdated", "Password updated"),
        description: "Use your new password the next time you sign in.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: t("common:error", "Could not change password"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPasswordBusy(false);
    }
  };

  const initial =
    (fullName?.charAt(0) || user?.email?.charAt(0) || "U").toUpperCase();

  return (
    <PageShell maxWidth="md" className="space-y-8">
      <PageHeader
        icon={<User className="h-5 w-5" />}
        title={t("auth:profileTitle", "Profile")}
        description={t("auth:profileSubtitle", "Manage your personal information, credentials, and access settings.")}
      />

      {/* Hero card */}
      <Card className="rounded-2xl overflow-hidden border border-border/80 shadow-xs">
        <div className="h-28 gradient-hero relative" style={{
            background: "linear-gradient(135deg, hsl(var(--primary) / 0.9) 0%, hsl(18 92% 42%) 55%, hsl(217 28% 17%) 100%)",
          }}>
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 50%, white 0%, transparent 40%)",
            }}
          />
        </div>
        <CardContent className="relative pt-0 pb-6 px-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 sm:-mt-14">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4">
              <div className="relative group">
                <Avatar className="h-24 w-24 sm:h-28 sm:w-28 ring-4 ring-background shadow-xl">
                  <AvatarImage src={avatarData || undefined} alt={fullName} />
                  <AvatarFallback className="text-2xl font-bold bg-primary text-primary-foreground">
                    {initial}
                  </AvatarFallback>
                </Avatar>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute bottom-1 right-1 h-9 w-9 rounded-full border-2 border-background shadow-md"
                  onClick={() => fileInputRef.current?.click()}
                  title="Change photo"
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileChange}
                />
              </div>
              <div className="pb-1 text-center sm:text-left">
                <h2 className="text-xl font-bold tracking-tight">{fullName || "Your name"}</h2>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <Badge variant="secondary" className="gap-1 font-medium">
                    <Shield className="h-3 w-3" />
                    {roleLabel(role)}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personal info */}
      <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-primary" />
            {t("auth:profileTitle", "Personal information")}
          </CardTitle>
          <CardDescription>{t("auth:profileSubtitle", "How your name appears across the dashboard.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="fullName">{t("auth:fullName", "Full name")}</Label>
            <Input
              id="fullName"
              placeholder={t("auth:fullName", "Enter your full name")}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {t("auth:emailLabel", "Email")}
            </Label>
            <Input id="email" value={user?.email || ""} disabled className="h-11 bg-muted/40" />
            <p className="text-xs text-muted-foreground">Email is tied to your login and cannot be changed here.</p>
          </div>

          <Separator />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={loading}
              onClick={() => {
                setFullName(profile?.full_name || "");
                setAvatarData(profile?.avatar_url || "");
              }}
            >
              {t("common:reset", "Reset")}
            </Button>
            <Button type="button" className="h-11 min-w-[140px] w-full sm:w-auto gap-2" disabled={loading} onClick={() => void handleSave()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {loading ? t("common:saving", "Saving…") : t("common:saveChanges", "Save changes")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Password */}
      <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5 text-primary" />
            {t("auth:changePassword", "Change password")}
          </CardTitle>
          <CardDescription>{t("auth:profileSubtitle", "Use a strong password you do not reuse elsewhere.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-5">
            <PasswordField
              id="currentPassword"
              label={t("auth:passwordLabel", "Current password")}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggle={() => setShowCurrent((v) => !v)}
              autoComplete="current-password"
            />
            <PasswordField
              id="newPassword"
              label={t("auth:newPassword", "New password")}
              value={newPassword}
              onChange={setNewPassword}
              show={showNew}
              onToggle={() => setShowNew((v) => !v)}
              autoComplete="new-password"
              hint="At least 8 characters"
            />
            <PasswordField
              id="confirmPassword"
              label={t("auth:confirmPassword", "Confirm new password")}
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
              autoComplete="new-password"
            />

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button type="submit" className="h-11 min-w-[160px] w-full sm:w-auto gap-2" disabled={passwordBusy}>
                {passwordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {passwordBusy ? t("common:saving", "Updating…") : t("auth:updateProfile", "Update password")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          className="h-11 pr-11"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg")}
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
