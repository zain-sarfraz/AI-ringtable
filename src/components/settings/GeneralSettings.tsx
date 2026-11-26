import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { Save, Globe, KeyRound, Eye, EyeOff } from "lucide-react";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { toast } from "sonner";

export function GeneralSettings() {
  const { t } = useTranslation(["settings", "auth", "common"]);
  const { profile, role } = useAuth();

  // ── Change Password state ─────────────────────────────────
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async () => {
    if (!newPw || !currentPw) {
      toast.error("Please fill in all password fields");
      return;
    }
    if (newPw.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("New passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to change password");
        return;
      }
      toast.success("Password changed successfully");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch {
      toast.error("Network error — could not change password");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Language Preferences Card */}
      <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t("settings:selectLanguage", "Language & Localization")}
          </CardTitle>
          <CardDescription>
            {t("settings:languageDesc", "Choose your preferred language for the admin interface")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3.5 border rounded-xl bg-card">
            <div>
              <p className="font-semibold text-sm text-foreground">{t("common:language", "Language")}</p>
              <p className="text-xs text-muted-foreground">{t("settings:languageDesc", "Current language used across all admin dashboards")}</p>
            </div>
            <LanguageSwitcher variant="outline" />
          </div>
        </CardContent>
      </Card>

      {/* Profile Settings Card */}
      <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
        <CardHeader>
          <CardTitle>{t("auth:profileTitle", "Profile Settings")}</CardTitle>
          <CardDescription>{t("auth:profileSubtitle", "Update your personal information")}</CardDescription>
        </CardHeader>
        <CardContent className="form-section">
          <div className="form-row">
            <div className="form-field">
              <Label htmlFor="fullName">{t("auth:fullName", "Full Name")}</Label>
              <Input id="fullName" defaultValue={profile?.full_name || ""} placeholder="Your name" />
            </div>
            <div className="form-field">
              <Label htmlFor="email">{t("common:email", "Email")}</Label>
              <Input id="email" type="email" defaultValue={profile?.email || ""} disabled />
            </div>
            <div className="form-field">
              <Label htmlFor="extension">{t("common:phone", "Phone Extension")}</Label>
              <Input id="extension" defaultValue={profile?.phone_extension || ""} placeholder="e.g. 101" />
            </div>
            <div className="form-field">
              <Label htmlFor="role">{t("common:status", "Role")}</Label>
              <Input id="role" value={role?.replace("_", " ").toUpperCase() || "AGENT"} disabled />
            </div>
          </div>
          <div className="form-actions">
            <Button className="gap-2 min-w-[140px]">
              <Save className="h-4 w-4" aria-hidden />
              {t("common:saveChanges", "Save Changes")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Card — visible to all roles */}
      <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            {t("settings:changePassword", "Change Password")}
          </CardTitle>
          <CardDescription>
            {t("settings:changePasswordDesc", "Update your login password. Minimum 8 characters.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current password */}
          <div className="space-y-1.5">
            <Label htmlFor="currentPw">{t("settings:currentPassword", "Current Password")}</Label>
            <div className="relative">
              <Input
                id="currentPw"
                type={showCurrent ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Enter current password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label={showCurrent ? "Hide password" : "Show password"}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div className="space-y-1.5">
            <Label htmlFor="newPw">{t("settings:newPassword", "New Password")}</Label>
            <div className="relative">
              <Input
                id="newPw"
                type={showNew ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 8 characters"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Confirm new password */}
          <div className="space-y-1.5">
            <Label htmlFor="confirmPw">{t("settings:confirmPassword", "Confirm New Password")}</Label>
            <Input
              id="confirmPw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Re-enter new password"
            />
            {confirmPw && newPw && confirmPw !== newPw && (
              <p className="text-xs text-destructive mt-1">Passwords do not match</p>
            )}
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={pwLoading || !currentPw || !newPw || !confirmPw || newPw !== confirmPw}
            className="gap-2 min-w-[160px]"
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            {pwLoading ? "Saving…" : t("settings:changePassword", "Change Password")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
