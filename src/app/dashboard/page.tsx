import { AppShell } from "@/components/layout/app-shell";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default function DashboardPage() {
  return (
    <AppShell
      title="Dashboard"
      description="Month-to-date sales, incentive payout, store health, and where to focus for the month and vertical you select below."
    >
      <DashboardView />
    </AppShell>
  );
}
