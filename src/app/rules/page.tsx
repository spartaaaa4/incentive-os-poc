import { AppShell } from "@/components/layout/app-shell";
import { RulesView } from "@/components/rules/rules-view";

export default function RulesPage() {
  return (
    <AppShell title="Incentive Rules">
      <RulesView />
    </AppShell>
  );
}
