import { AppShell } from "@/components/layout/app-shell";
import { TargetsView } from "@/components/targets/targets-view";

export default function TargetsPage() {
  return (
    <AppShell title="Targets">
      <TargetsView />
    </AppShell>
  );
}
