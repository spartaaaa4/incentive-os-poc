"use client";

import { useEffect, useMemo, useState } from "react";
import { Vertical } from "@prisma/client";
import { formatInr, formatNumber } from "@/lib/format";

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
  stores: Array<{
    storeCode: string;
    storeName: string;
    storeFormat: string;
    employeeCount: number;
    totalIncentive: number;
    achievementPct: number;
  }>;
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

export function DashboardView() {
  const [selected, setSelected] = useState<"ALL" | Vertical>("ALL");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const qs = selected === "ALL" ? "" : `?vertical=${selected}`;
    fetch(`/api/dashboard${qs}`)
      .then((res) => res.json())
      .then((payload: DashboardResponse) => setData(payload))
      .finally(() => setLoading(false));
  }, [selected]);

  const statCards = useMemo(
    () => [
      { label: "Total Active Associates", value: data ? formatNumber(data.stats.totalEmployees) : "-" },
      { label: "Total Incentive Paid (MTD)", value: data ? formatInr(data.stats.totalIncentiveMtd) : "-" },
      {
        label: "Avg Incentive / Employee",
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
    <div className="space-y-6">
      <div className="flex gap-2">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSelected(option.value)}
            className={`px-3 py-1.5 text-sm rounded-full border ${
              selected === option.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{card.label}</p>
            <p className="text-2xl font-semibold mt-2">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">Store Performance</h3>
          <div className="mt-4 space-y-3">
            {(data?.stores ?? []).map((store) => (
              <div key={store.storeCode} className="border border-slate-200 rounded-lg p-3">
                <div className="flex justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{store.storeName}</p>
                    <p className="text-xs text-slate-500">
                      {store.storeCode} • {store.storeFormat}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-blue-700">
                    {store.achievementPct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-600 flex gap-6">
                  <span>Incentive: {formatInr(store.totalIncentive)}</span>
                  <span>Employees: {store.employeeCount}</span>
                </div>
              </div>
            ))}
            {loading && <p className="text-sm text-slate-500">Loading dashboard...</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">System Alerts</h3>
          <div className="mt-4 space-y-2 text-sm">
            <p>Pending approvals: {data?.alerts.pendingApprovals ?? 0}</p>
            <p>Stores below gate threshold: {data?.alerts.belowThresholdStores ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
        <h3 className="font-semibold text-slate-900 mb-3">Top 10 Performers</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-2">Rank</th>
              <th>Name</th>
              <th>Role</th>
              <th>Store</th>
              <th className="text-right">Incentive</th>
            </tr>
          </thead>
          <tbody>
            {(data?.topPerformers ?? []).map((performer) => (
              <tr key={`${performer.rank}-${performer.employeeName}`} className="border-t border-slate-100">
                <td className="py-2">{performer.rank}</td>
                <td>{performer.employeeName}</td>
                <td>{performer.role}</td>
                <td>{performer.storeCode}</td>
                <td className="text-right">{formatInr(performer.incentive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
