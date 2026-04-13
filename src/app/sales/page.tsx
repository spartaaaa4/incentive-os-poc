import { AppShell } from "@/components/layout/app-shell";
import { SalesView } from "@/components/sales/sales-view";

export default function SalesPage() {
  return (
    <AppShell title="Sales Data">
      <SalesView />
    </AppShell>
  );
}
