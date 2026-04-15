"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, Line, ComposedChart,
} from "recharts";
import { Vertical } from "@/lib/constants";
import { formatInr, formatNumber } from "@/lib/format";
import { IncentiveDrilldown } from "@/components/dashboard/incentive-drilldown";
import {
  TrendingUp, TrendingDown, IndianRupee, ShoppingCart,
  Award, Target, Store, AlertTriangle, ChevronRight,
  ChevronLeft, Info, ChevronDown, ChevronUp, Clock,
  Users,
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
  month: string;
  monthLabel: string;
  lastCalculatedAt: string | null;
  stats: {
    totalEmployees: number;
    employeesEarning: number;
    totalSalesMtd: number;
    totalTarget: number;
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
  dailySalesTrend: Array<{ date: string; label: string; sales: number; transactions: number; targetPace: number }>;
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

function buildMonthOptions() {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let offset = -6; offset <= 6; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const kpiTooltips: Record<string, string> = {
  sales: "Total gross sales across all stores for the selected month and vertical.",
  incentive: "Total incentive earned by all employees this month, after multiplier/slab application.",
  upside: "Additional incentive that would be earned if every store reaches 100% achievement. This is money being left on the table.",
  achievement: "Average achievement percentage across all stores. Company benchmark is 90%.",
  plans: "Number of incentive plans currently in ACTIVE status for the selected vertical.",
};

export function DashboardView() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selected, setSelected] = useState<"ALL" | Vertical>("ALL");
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("drilldown");
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // For clickable below-threshold stores → drill into store
  const drilldownRef = useRef<{ drillToStore: (storeCode: string, storeName: string) => void } | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selected !== "ALL") params.set("vertical", selected);
    params.set("month", month);
    fetch(`/api/dashboard?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: DashboardResponse) => setData(payload))
      .catch((err) => console.error("Dashboard fetch failed:", err))
      .finally(() => setLoading(false));
  }, [selected, month]);

  const unlockable = useMemo(() => {
    if (!data) return 0;
    return data.stats.potentialIncentive - data.stats.totalIncentiveMtd;
  }, [data]);

  const handleBelowThresholdClick = (storeCode: string, storeName: string) => {
    setTab("drilldown");
    setOverviewCollapsed(true);
    // Small delay so drilldown component mounts first
    setTimeout(() => {
      drilldownRef.current?.drillToStore(storeCode, storeName);
    }, 100);
  };

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
      <div className="flex items-center justify-between flex-wrap gap-3">
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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const idx = monthOptions.findIndex((m) => m.value === month);
                if (idx > 0) setMonth(monthOptions[idx - 1].value);
              }}
              disabled={month === monthOptions[0].value}
              className="p-1 rounded hover:bg-slate-200 text-slate-400 disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="text-sm font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const idx = monthOptions.findIndex((m) => m.value === month);
                if (idx < monthOptions.length - 1) setMonth(monthOptions[idx + 1].value);
              }}
              disabled={month === monthOptions[monthOptions.length - 1].value}
              className="p-1 rounded hover:bg-slate-200 text-slate-400 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {/* Last updated timestamp */}
          {data?.lastCalculatedAt && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock size={12} />
              <span>Last updated: {new Date(data.lastCalculatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {new Date(data.lastCalculatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}
        </div>
      </div>

      {data && (
        <>
          {/* Collapsible overview section */}
          {overviewCollapsed ? (
            <button
              onClick={() => setOverviewCollapsed(false)}
              className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <span>
                {data.monthLabel} &middot; {formatInr(data.stats.totalSalesMtd)} Sales &middot; {formatInr(data.stats.totalIncentiveMtd)} Earned &middot; {data.stats.avgAchievementPct}% Avg Achievement
              </span>
              <ChevronDown size={16} className="text-slate-400" />
            </button>
          ) : (
            <>
              {/* Hero metric cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <MetricCard
                  icon={<ShoppingCart size={18} />}
                  iconBg="bg-blue-100 text-blue-600"
                  label="Total Sales MTD"
                  value={formatInr(data.stats.totalSalesMtd)}
                  subtitle={`Target: ${formatInr(data.stats.totalTarget)}`}
                  tooltipKey="sales"
                  activeTooltip={activeTooltip}
                  setActiveTooltip={setActiveTooltip}
                />
                <MetricCard
                  icon={<IndianRupee size={18} />}
                  iconBg="bg-emerald-100 text-emerald-600"
                  label="Incentives Earned"
                  value={formatInr(data.stats.totalIncentiveMtd)}
                  subtitle={`of ${formatInr(data.stats.potentialIncentive)} potential`}
                  accent="text-emerald-700"
                  tooltipKey="incentive"
                  activeTooltip={activeTooltip}
                  setActiveTooltip={setActiveTooltip}
                />
                <MetricCard
                  icon={<Award size={18} />}
                  iconBg="bg-amber-100 text-amber-600"
                  label="Incentive Upside"
                  value={formatInr(unlockable)}
                  subtitle="gap to full payout"
                  accent="text-amber-700"
                  tooltipKey="upside"
                  activeTooltip={activeTooltip}
                  setActiveTooltip={setActiveTooltip}
                />
                <MetricCard
                  icon={<Target size={18} />}
                  iconBg="bg-indigo-100 text-indigo-600"
                  label="Avg Achievement"
                  value={`${data.stats.avgAchievementPct}%`}
                  trend={data.stats.avgAchievementPct >= 100}
                  badge={<AchievementBadge pct={data.stats.avgAchievementPct} />}
                  tooltipKey="achievement"
                  activeTooltip={activeTooltip}
                  setActiveTooltip={setActiveTooltip}
                />
                <MetricCard
                  icon={<Store size={18} />}
                  iconBg="bg-slate-100 text-slate-600"
                  label="Active Incentive Plans"
                  value={formatNumber(data.stats.activeSchemes)}
                  subtitle={`${formatNumber(data.stats.stores)} stores, ${formatNumber(data.stats.totalEmployees)} associates`}
                  tooltipKey="plans"
                  activeTooltip={activeTooltip}
                  setActiveTooltip={setActiveTooltip}
                />
              </div>

              {/* Earning vs not earning */}
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm">
                <Users size={14} className="text-slate-400" />
                <span className="text-slate-600">
                  <span className="font-semibold text-emerald-700">{formatNumber(data.stats.employeesEarning)}</span>
                  {" "}of{" "}
                  <span className="font-semibold text-slate-900">{formatNumber(data.stats.totalEmployees)}</span>
                  {" "}associates earning incentives this month
                </span>
                <div className="flex-1 mx-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${data.stats.totalEmployees > 0 ? Math.round((data.stats.employeesEarning / data.stats.totalEmployees) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 font-medium">
                  {data.stats.totalEmployees > 0 ? Math.round((data.stats.employeesEarning / data.stats.totalEmployees) * 100) : 0}%
                </span>
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
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {data.alerts.belowThresholdList.map((s) => (
                            <button
                              key={s.storeCode}
                              onClick={() => handleBelowThresholdClick(s.storeCode, s.storeName)}
                              className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 hover:text-red-900 transition-colors cursor-pointer"
                            >
                              {s.storeName} ({s.achievementPct}%)
                              <ChevronRight size={10} />
                            </button>
                          ))}
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
                <ChartCard title="Daily Sales Trend" subtitle="Actual sales vs target pace">
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={data.dailySalesTrend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
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
                        formatter={(value, name) => [formatInr(Number(value)), name === "sales" ? "Actual Sales" : "Target Pace"]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGrad)" />
                      <Line type="monotone" dataKey="targetPace" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                    </ComposedChart>
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
                          <p className="font-medium text-slate-700">{v.avgAchievementPct}% <AchievementBadge pct={v.avgAchievementPct} /></p>
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

              {/* Collapse button */}
              <button
                onClick={() => setOverviewCollapsed(true)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors mx-auto"
              >
                <ChevronUp size={14} /> Collapse overview
              </button>
            </>
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
                {t === "drilldown" ? "Store & Employee Breakdown" : "Top Performers"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "drilldown" && (
            <IncentiveDrilldown ref={drilldownRef} vertical={selected === "ALL" ? "" : selected} month={month} />
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

function AchievementBadge({ pct }: { pct: number }) {
  const color = pct >= 100 ? "bg-emerald-100 text-emerald-700" : pct >= 85 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  const label = pct >= 100 ? "On track" : pct >= 90 ? "Near target" : pct >= 85 ? "Below target" : "Critical";
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${color}`}>{label}</span>;
}

function MetricCard({
  icon,
  iconBg,
  label,
  value,
  subtitle,
  accent,
  trend,
  badge,
  tooltipKey,
  activeTooltip,
  setActiveTooltip,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  subtitle?: string;
  accent?: string;
  trend?: boolean;
  badge?: React.ReactNode;
  tooltipKey?: string;
  activeTooltip: string | null;
  setActiveTooltip: (key: string | null) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 relative">
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`rounded-lg p-1.5 ${iconBg}`}>{icon}</div>
        <p className="text-xs text-slate-500 uppercase tracking-wide leading-tight flex-1">{label}</p>
        {tooltipKey && (
          <button
            onClick={() => setActiveTooltip(activeTooltip === tooltipKey ? null : tooltipKey)}
            className="text-slate-300 hover:text-slate-500 transition-colors"
          >
            <Info size={13} />
          </button>
        )}
      </div>
      {tooltipKey && activeTooltip === tooltipKey && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-600 shadow-lg">
          {kpiTooltips[tooltipKey]}
        </div>
      )}
      <div className="flex items-end gap-2">
        <p className={`text-2xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
        {trend !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-medium mb-0.5 ${trend ? "text-emerald-600" : "text-red-500"}`}>
            {trend ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          </span>
        )}
        {badge}
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
