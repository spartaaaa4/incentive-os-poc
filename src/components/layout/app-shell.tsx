import { AdminChrome } from "@/components/layout/admin-chrome";

type AppShellProps = {
  title: string;
  children: React.ReactNode;
};

export function AppShell({ title, children }: AppShellProps) {
  return <AdminChrome title={title}>{children}</AdminChrome>;
}
