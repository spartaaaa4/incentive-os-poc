import { AdminChrome } from "@/components/layout/admin-chrome";
import { AdminsView } from "@/components/admins/admins-view";

export const dynamic = "force-dynamic";

export default function AdminsPage() {
  return (
    <AdminChrome
      title="Admin users"
      description="Grant and revoke admin access for store employees. Verticals and granular flags control what each admin can see and do."
    >
      <AdminsView />
    </AdminChrome>
  );
}
