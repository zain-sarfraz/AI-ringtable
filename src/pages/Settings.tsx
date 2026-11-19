import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { UserManagement } from "@/components/settings/UserManagement";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

export default function Settings() {
  const { t } = useTranslation(["settings", "sidebar", "common"]);
  const { role, isManagement, isKitchen, isReceptionist, isStaff } = useAuth();
  const showUserManagement = role === "super_admin" && !isKitchen && !isReceptionist && !isStaff;
  const showSecurity = isManagement || isKitchen || isReceptionist || isStaff;

  return (
    <PageShell maxWidth="md">
      <PageHeader
        title={t("settings:title", "Settings")}
        description={t("settings:subtitle", "Manage your preferences and integrations")}
      />

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="h-auto flex-wrap justify-start gap-1 w-full sm:w-auto">
          <TabsTrigger value="general">{t("settings:tabGeneral", "General")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("settings:tabNotifications", "Notifications")}</TabsTrigger>
          {showUserManagement && <TabsTrigger value="users">{t("settings:tabUserManagement", "Users")}</TabsTrigger>}
          {showSecurity && <TabsTrigger value="security">{t("settings:tabSecurity", "Security")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <NotificationSettings />
        </TabsContent>

        {showUserManagement && (
          <TabsContent value="users" className="space-y-6">
            <UserManagement />
          </TabsContent>
        )}

        {showSecurity && (
          <TabsContent value="security" className="space-y-6">
            <SecuritySettings />
          </TabsContent>
        )}
      </Tabs>
    </PageShell>
  );
}

