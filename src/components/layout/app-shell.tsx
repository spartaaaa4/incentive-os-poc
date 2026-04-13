import { TopNav } from "@/components/layout/top-nav";
import { SeedBanner } from "@/components/layout/seed-banner";

type AppShellProps = {
  title: string;
  children: React.ReactNode;
};

export function AppShell({ title, children }: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TopNav />
      <main className="flex-1">
        <header className="px-8 py-4 bg-white border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        </header>
        <SeedBanner />
        <section className="p-6 lg:p-8">{children}</section>
      </main>
    </div>
  );
}
