import { AppShell } from "@/components/layout/app-shell";
import { ApprovalsView } from "@/components/approvals/approvals-view";

export default function ApprovalsPage() {
  return (
    <AppShell title="Approvals">
      <ApprovalsView />
    </AppShell>
  );
}
