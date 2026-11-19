import { Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export function SecuritySettings() {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          {t("settings:securityTitle", "Security Settings")}
        </CardTitle>
        <CardDescription>{t("settings:securityDesc", "Manage organization security")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="setting-row">
          <div className="space-y-0.5 min-w-0">
            <Label>{t("settings:twoFactor", "Two-Factor Authentication")}</Label>
            <p className="text-sm text-muted-foreground">{t("settings:twoFactorDesc", "Require 2FA for all users")}</p>
          </div>
          <Switch />
        </div>
        <div className="setting-row">
          <div className="space-y-0.5 min-w-0">
            <Label>{t("settings:sessionTimeout", "Session Timeout")}</Label>
            <p className="text-sm text-muted-foreground">{t("settings:sessionTimeoutDesc", "Auto-logout after inactivity")}</p>
          </div>
          <Switch defaultChecked />
        </div>
        <div className="setting-row">
          <div className="space-y-0.5 min-w-0">
            <Label>{t("settings:auditLogging", "Audit Logging")}</Label>
            <p className="text-sm text-muted-foreground">{t("settings:auditLoggingDesc", "Track all user actions")}</p>
          </div>
          <Switch defaultChecked />
        </div>
      </CardContent>
    </Card>
  );
}
