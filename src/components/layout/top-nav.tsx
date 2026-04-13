"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, Database, Gauge, Target, Zap, User } from "lucide-react";
import clsx from "clsx";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/sales", label: "Sales", icon: ClipboardList },
  { href: "/rules", label: "Rules", icon: Zap },
  { href: "/targets", label: "Targets", icon: Target },
  { href: "/approvals", label: "Approvals", icon: BarChart3 },
  { href: "/data-model", label: "Data Model", icon: Database },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="bg-sidebar text-slate-100 border-b border-slate-700">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center text-white font-bold text-xs">IO</div>
            <span className="text-sm font-semibold hidden sm:inline">Incentive OS</span>
          </Link>

          <nav className="flex items-center gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-slate-700/80 text-white"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                  )}
                >
                  <Icon size={14} />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <User size={14} />
          <span className="hidden sm:inline">Admin</span>
        </div>
      </div>
    </header>
  );
}
