import { AppShell } from "@/components/layout/app-shell";

export default function RulesPage() {
  return (
    <AppShell title="Incentive Rules">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">
          Rules configuration UI is queued for Phase 2. Data model and calculation services are
          already scaffolded to support Electronics, Grocery, and F&L configurations.
        </p>
      </div>
    </AppShell>
  );
}
