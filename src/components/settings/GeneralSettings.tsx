import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { Save, Globe } from "lucide-react";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";

export function GeneralSettings() {
  const { t } = useTranslation(["settings", "auth", "common"]);
  const { profile, role } = useAuth();

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
    </div>
  );
}

