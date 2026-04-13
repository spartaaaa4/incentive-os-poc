"use client";

import { useEffect, useMemo, useState } from "react";
import { Vertical } from "@/lib/constants";
import { formatInr, formatNumber } from "@/lib/format";
import { IncentiveDrilldown } from "@/components/dashboard/incentive-drilldown";

type DashboardResponse = {
  stats: {
    totalEmployees: number;
    totalIncentiveMtd: number;
    activeSchemes: number;
    stores: number;
  };
  alerts: {
    pendingApprovals: number;
    belowThresholdStores: number;
  };
  topPerformers: Array<{
    rank: number;
    employeeName: string;
    role: string;
    storeCode: string;
    incentive: number;
  }>;
};

const filterOptions: Array<{ label: string; value: "ALL" | Vertical }> = [
  { label: "All", value: "ALL" },
  { label: "Electronics", value: Vertical.ELECTRONICS },
  { label: "Grocery", value: Vertical.GROCERY },
  { label: "F&L", value: Vertical.FNL },
];

type Tab = "overview" | "drilldown";

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

  const statCards = useMemo(
    () => [
      { label: "Active Associates", value: data ? formatNumber(data.stats.totalEmployees) : "-" },
      { label: "Incentive MTD", value: data ? formatInr(data.stats.totalIncentiveMtd) : "-" },
      {
        label: "Avg / Employee",
        value:
          data && data.stats.totalEmployees
            ? formatInr(data.stats.totalIncentiveMtd / data.stats.totalEmployees)
            : "-",
      },
      { label: "Active Schemes", value: data ? formatNumber(data.stats.activeSchemes) : "-" },
    ],
    [data],
  );

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{card.label}</p>
            <p className="text-2xl font-semibold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Alerts row */}
      {data && (data.alerts.pendingApprovals > 0 || data.alerts.belowThresholdStores > 0) && (
        <div className="flex gap-3">
          {data.alerts.pendingApprovals > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {data.alerts.pendingApprovals} pending approval{data.alerts.pendingApprovals > 1 ? "s" : ""}
            </div>
          )}
          {data.alerts.belowThresholdStores > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              {data.alerts.belowThresholdStores} store{data.alerts.belowThresholdStores > 1 ? "s" : ""} below gate threshold
            </div>
          )}
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex gap-2 border-b border-slate-200 pb-0">
        {(["drilldown", "overview"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t === "drilldown" ? "Incentive Drill-Down" : "Top Performers"}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex gap-1.5 items-center">
          {filterOptions.map((option) => (
            <button key={option.value} onClick={() => setSelected(option.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selected === option.value ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300"}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === "drilldown" && <IncentiveDrilldown />}

      {tab === "overview" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
          <h3 className="font-semibold text-slate-900 mb-3">Top 10 Performers</h3>
          {loading && <p className="text-sm text-slate-500">Loading...</p>}
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-2">Rank</th><th>Name</th><th>Role</th><th>Store</th><th className="text-right">Incentive</th>
              </tr>
            </thead>
            <tbody>
              {(data?.topPerformers ?? []).map((performer) => (
                <tr key={`${performer.rank}-${performer.employeeName}`} className="border-t border-slate-100">
                  <td className="py-2">{performer.rank}</td>
                  <td>{performer.employeeName}</td>
                  <td>{performer.role}</td>
                  <td>{performer.storeCode}</td>
                  <td className="text-right font-medium">{formatInr(performer.incentive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
