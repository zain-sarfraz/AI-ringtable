import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveStatsHeader } from "@/components/auto-dialer/LiveStatsHeader";
import { SessionsListView } from "@/components/auto-dialer/SessionsListView";
import { SessionDetailView } from "@/components/auto-dialer/SessionDetailView";
import { PageHeader, PageShell } from "@/components/layout/PageShell";
import { PhoneCall } from "lucide-react";

export default function AutoDialer() {
  const { t } = useTranslation(["calls", "common"]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  return (
    <PageShell>
      <PageHeader
        title={t("calls:autoDialer", "AI Auto-Dialer")}
        description={t("calls:autoDialerDesc", "Upload client data, let AI analyze and call each contact automatically. Runs in the background — safe to close browser.")}
        icon={<PhoneCall className="h-5 w-5" />}
      />

      <LiveStatsHeader />

      {activeSessionId ? (
        <SessionDetailView sessionId={activeSessionId} onBack={() => setActiveSessionId(null)} />
      ) : (
        <SessionsListView onSelect={setActiveSessionId} />
      )}
    </PageShell>
  );
}

