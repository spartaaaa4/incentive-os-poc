"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, Database, Gauge, Target, Zap } from "lucide-react";
import clsx from "clsx";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/sales", label: "Sales Data", icon: ClipboardList },
  { href: "/rules", label: "Incentive Rules", icon: Zap },
  { href: "/targets", label: "Targets", icon: Target },
  { href: "/approvals", label: "Approvals", icon: BarChart3 },
  { href: "/data-model", label: "Data Model", icon: Database },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-sidebar text-slate-100 flex flex-col">
      <div className="px-5 py-6 border-b border-slate-700">
        <h1 className="text-lg font-semibold">Incentive OS</h1>
        <p className="text-xs text-slate-400">Reliance Retail</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border-l-2",
                isActive
                  ? "bg-slate-800 border-l-accent text-white"
                  : "border-l-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white",
              )}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-700">
        <div className="rounded-md bg-slate-800 px-3 py-2">
          <p className="text-sm font-medium">Admin User</p>
          <p className="text-xs text-slate-400">Operations</p>
        </div>
      </div>
    </aside>
  );
}
