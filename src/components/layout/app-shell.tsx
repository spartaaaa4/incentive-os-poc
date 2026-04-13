import { Sidebar } from "@/components/layout/sidebar";

type AppShellProps = {
  title: string;
  children: React.ReactNode;
};

export function AppShell({ title, children }: AppShellProps) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 bg-slate-50">
        <header className="px-8 py-5 bg-white border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        </header>
        <section className="p-8">{children}</section>
      </main>
    </div>
  );
}
