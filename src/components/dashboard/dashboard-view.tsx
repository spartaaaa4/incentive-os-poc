"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from "recharts";
import { Vertical } from "@/lib/constants";
import { formatInr, formatNumber } from "@/lib/format";
import { IncentiveDrilldown } from "@/components/dashboard/incentive-drilldown";
import {
  TrendingUp, TrendingDown, IndianRupee, ShoppingCart,
  Award, Target, Store, AlertTriangle, ChevronRight,
} from "lucide-react";

type VerticalBreakdown = {
  vertical: string;
  stores: number;
  employees: number;
  salesMtd: number;
  incentiveEarned: number;
  avgAchievementPct: number;
};

type DashboardResponse = {
  stats: {
    totalEmployees: number;
    totalSalesMtd: number;
    totalIncentiveMtd: number;
    potentialIncentive: number;
    avgAchievementPct: number;
    activeSchemes: number;
    stores: number;
  };
  alerts: {
    pendingApprovals: number;
    belowThresholdStores: number;
    belowThresholdList: Array<{ storeCode: string; storeName: string; achievementPct: number }>;
  };
  verticalBreakdown: VerticalBreakdown[];
  achievementDistribution: Array<{ bucket: string; count: number }>;
  dailySalesTrend: Array<{ date: string; label: string; sales: number; transactions: number }>;
  topPerformers: Array<{
    rank: number;
    employeeName: string;
    role: string;
    storeCode: string;
    incentive: number;
  }>;
};

const verticalLabels: Record<string, string> = {
  ELECTRONICS: "Electronics",
  GROCERY: "Grocery",
  FNL: "Fashion & Lifestyle",
};
const verticalColors: Record<string, string> = {
  ELECTRONICS: "bg-blue-500",
  GROCERY: "bg-emerald-500",
  FNL: "bg-violet-500",
};
const verticalBorders: Record<string, string> = {
  ELECTRONICS: "border-blue-200",
  GROCERY: "border-emerald-200",
  FNL: "border-violet-200",
};

const filterOptions: Array<{ label: string; value: "ALL" | Vertical }> = [
  { label: "All Verticals", value: "ALL" },
  { label: "Electronics", value: Vertical.ELECTRONICS },
  { label: "Grocery", value: Vertical.GROCERY },
  { label: "F&L", value: Vertical.FNL },
];

type Tab = "drilldown" | "overview";

export function DashboardView() {
  const [selected, setSelected] = useState<"ALL" | Vertical>("ALL");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("drilldown");

  useEffect(() => {
    setLoading(true);
    const qs = selected === "ALL" ? "" : `?vertical=${selected}`;
    fetch(`/api/dashboard${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: DashboardResponse) => setData(payload))
      .catch((err) => console.error("Dashboard fetch failed:", err))
      .finally(() => setLoading(false));
  }, [selected]);

  const unlockable = useMemo(() => {
    if (!data) return 0;
    return data.stats.potentialIncentive - data.stats.totalIncentiveMtd;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setSelected(option.value)}
              className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition-all ${
                selected === option.value
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">April 2026 MTD</p>
      </div>

      {data && (
        <>
          {/* Hero metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <MetricCard
              icon={<ShoppingCart size={18} />}
              iconBg="bg-blue-100 text-blue-600"
              label="Total Sales MTD"
              value={formatInr(data.stats.totalSalesMtd)}
            />
            <MetricCard
              icon={<IndianRupee size={18} />}
              iconBg="bg-emerald-100 text-emerald-600"
              label="Incentives Earned"
              value={formatInr(data.stats.totalIncentiveMtd)}
              accent="text-emerald-700"
            />
            <MetricCard
              icon={<Award size={18} />}
              iconBg="bg-amber-100 text-amber-600"
              label="Potential Unlockable"
              value={formatInr(unlockable)}
              subtitle="if stores hit 100%"
              accent="text-amber-700"
            />
            <MetricCard
              icon={<Target size={18} />}
              iconBg="bg-indigo-100 text-indigo-600"
              label="Avg Achievement"
              value={`${data.stats.avgAchievementPct}%`}
              trend={data.stats.avgAchievementPct >= 100}
            />
            <MetricCard
              icon={<Store size={18} />}
              iconBg="bg-slate-100 text-slate-600"
              label="Active Schemes"
              value={formatNumber(data.stats.activeSchemes)}
              subtitle={`${formatNumber(data.stats.stores)} stores, ${formatNumber(data.stats.totalEmployees)} associates`}
            />
          </div>

          {/* Alerts */}
          {(data.alerts.pendingApprovals > 0 || data.alerts.belowThresholdStores > 0) && (
            <div className="flex flex-wrap gap-3">
              {data.alerts.pendingApprovals > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                  <AlertTriangle size={14} />
                  <span className="font-medium">{data.alerts.pendingApprovals} pending approval{data.alerts.pendingApprovals > 1 ? "s" : ""}</span>
                </div>
              )}
              {data.alerts.belowThresholdStores > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle size={14} />
                    {data.alerts.belowThresholdStores} store{data.alerts.belowThresholdStores > 1 ? "s" : ""} below gate threshold
                  </div>
                  {data.alerts.belowThresholdList.length > 0 && (
                    <div className="mt-1 text-xs text-red-600">
                      {data.alerts.belowThresholdList.map((s) => `${s.storeName} (${s.achievementPct}%)`).join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Store Achievement Distribution" subtitle="Number of stores per achievement band">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.achievementDistribution} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    formatter={(value) => [String(value), "Stores"]}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Daily Sales Trend" subtitle="Gross sales value across all stores">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.dailySalesTrend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    formatter={(value) => [formatInr(Number(value)), "Sales"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Vertical breakdown cards */}
          {selected === "ALL" && data.verticalBreakdown.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.verticalBreakdown.map((v) => (
                <button
                  key={v.vertical}
                  onClick={() => setSelected(v.vertical as Vertical)}
                  className={`text-left rounded-xl border ${verticalBorders[v.vertical] ?? "border-slate-200"} bg-white p-4 hover:shadow-md transition-all group`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${verticalColors[v.vertical] ?? "bg-slate-400"}`} />
                      <span className="font-semibold text-slate-900">{verticalLabels[v.vertical] ?? v.vertical}</span>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-2.5 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Sales</p>
                      <p className="font-semibold text-slate-900">{formatInr(v.salesMtd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Incentive Earned</p>
                      <p className="font-semibold text-emerald-700">{formatInr(v.incentiveEarned)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Avg Achievement</p>
                      <p className="font-medium text-slate-700">{v.avgAchievementPct}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Stores / Associates</p>
                      <p className="font-medium text-slate-700">{v.stores} / {v.employees}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Tab toggle */}
          <div className="flex gap-2 border-b border-slate-200 pb-0">
            {(["drilldown", "overview"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {t === "drilldown" ? "Incentive Drill-Down" : "Top Performers"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "drilldown" && (
            <IncentiveDrilldown vertical={selected === "ALL" ? "" : selected} />
          )}

          {tab === "overview" && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 overflow-x-auto">
              <h3 className="font-semibold text-slate-900 mb-3">Top 10 Performers</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500 bg-slate-50">
                  <tr>
                    <th className="py-2.5 px-3 rounded-tl-lg">Rank</th>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Store</th>
                    <th className="py-2.5 px-3 text-right rounded-tr-lg">Incentive</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.topPerformers ?? []).map((performer) => (
                    <tr key={`${performer.rank}-${performer.employeeName}`} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          performer.rank <= 3 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                        }`}>
                          {performer.rank}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium">{performer.employeeName}</td>
                      <td className="py-2.5 px-3">{performer.role}</td>
                      <td className="py-2.5 px-3">{performer.storeCode}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">{formatInr(performer.incentive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  iconBg,
  label,
  value,
  subtitle,
  accent,
  trend,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  subtitle?: string;
  accent?: string;
  trend?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`rounded-lg p-1.5 ${iconBg}`}>{icon}</div>
        <p className="text-xs text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <div className="flex items-end gap-2">
        <p className={`text-2xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
        {trend !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-medium mb-0.5 ${trend ? "text-emerald-600" : "text-red-500"}`}>
            {trend ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          </span>
        )}
      </div>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
