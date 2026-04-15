import { AdminChrome } from "@/components/layout/admin-chrome";

type AppShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function AppShell({ title, description, children }: AppShellProps) {
  return (
    <AdminChrome title={title} description={description}>
      {children}
    </AdminChrome>
  );
}
