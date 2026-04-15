"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, subMonths, startOfMonth } from "date-fns";
import { Loader2, Trophy, Building2, MapPin, Calendar, ChevronRight, Store, Filter } from "lucide-react";
import { formatInr, formatNumber } from "@/lib/format";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type StoreInfo = {
  storeCode: string;
  storeName: string;
  vertical: string;
  city: string;
  storeFormat: string;
  state: string;
  storeStatus: string;
};

type LeaderboardPeriod = {
  month: string;
  startDate: string;
  endDate: string;
  label: string;
  description: string;
};

type LeaderboardRow = {
  rank: number;
  employeeId: string;
  employeeName: string;
  role: string;
  storeCode: string;
  storeName: string;
  city: string;
  totalSales: number;
  transactionCount: number;
  isViewer?: boolean;
};

type AdminLeaderboardResponse = {
  metric: "TOTAL_SALES_GROSS";
  rankBy: "totalSales";
  scope: "store" | "city";
  vertical: string;
  city: string;
  storeCode: string | null;
  storeName: string | null;
  period: LeaderboardPeriod;
  leaderboard: LeaderboardRow[];
};

const verticalLabels: Record<string, string> = {
  ELECTRONICS: "Electronics",
  GROCERY: "Grocery",
  FNL: "Fashion & Lifestyle",
};

const verticalColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  ELECTRONICS: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800", dot: "bg-blue-500" },
  GROCERY: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800", dot: "bg-emerald-500" },
  FNL: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-800", dot: "bg-purple-500" },
};

function rollingMonthOptions(count: number): { value: string; label: string }[] {
  const base = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = subMonths(startOfMonth(base), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
  });
}

/* ------------------------------------------------------------------ */
/*  Rank badge                                                        */
/* ------------------------------------------------------------------ */

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-sm">🥇</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">🥈</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-100 text-orange-700 font-bold text-sm">🥉</span>;
  return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-50 text-slate-500 font-mono text-sm">{rank}</span>;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function LeaderboardView() {
  const monthOptions = useMemo(() => rollingMonthOptions(18), []);

  // Store metadata
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  // Filters
  const [selectedVertical, setSelectedVertical] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [month, setMonth] = useState(() => format(startOfMonth(new Date()), "yyyy-MM"));

  // Leaderboard data
  const [data, setData] = useState<AdminLeaderboardResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load stores on mount
  useEffect(() => {
    fetch("/api/stores")
      .then((r) => (r.ok ? r.json() : { stores: [] }))
      .then((d) => {
        setStores(d.stores ?? []);
        setStoresLoading(false);
      })
      .catch(() => setStoresLoading(false));
  }, []);

  // Derived filter options
  const verticals = useMemo(() => {
    const set = new Set(stores.map((s) => s.vertical));
    return ["ELECTRONICS", "GROCERY", "FNL"].filter((v) => set.has(v));
  }, [stores]);

  const cities = useMemo(() => {
    if (!selectedVertical) return [];
    const set = new Set(stores.filter((s) => s.vertical === selectedVertical).map((s) => s.city));
    return Array.from(set).sort();
  }, [stores, selectedVertical]);

  const cityStores = useMemo(() => {
    if (!selectedVertical || !selectedCity) return [];
    return stores
      .filter((s) => s.vertical === selectedVertical && s.city === selectedCity)
      .sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [stores, selectedVertical, selectedCity]);

  // Reset dependent selections when parent changes
  const handleVerticalChange = (v: string) => {
    setSelectedVertical(v);
    setSelectedCity("");
    setSelectedStore("");
    setData(null);
  };

  const handleCityChange = (c: string) => {
    setSelectedCity(c);
    setSelectedStore("");
    setData(null);
  };

  const handleStoreChange = (s: string) => {
    setSelectedStore(s);
  };

  // Load leaderboard
  const loadLeaderboard = useCallback(async () => {
    if (!selectedVertical || !selectedCity) return;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        vertical: selectedVertical,
        city: selectedCity,
        month,
      });
      if (selectedStore) params.set("storeCode", selectedStore);
      const res = await fetch(`/api/leaderboard?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedVertical, selectedCity, selectedStore, month]);

  // Auto-load when filters change (only if vertical+city are set)
  useEffect(() => {
    if (selectedVertical && selectedCity) {
      void loadLeaderboard();
    }
  }, [selectedVertical, selectedCity, selectedStore, month, loadLeaderboard]);

  const setThisMonth = () => setMonth(format(startOfMonth(new Date()), "yyyy-MM"));
  const setLastMonth = () => setMonth(format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM"));

  const vc = selectedVertical ? verticalColors[selectedVertical] : null;

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <Trophy size={14} className="text-amber-500" />
        <span className="font-medium text-slate-700">Leaderboard</span>
        {selectedVertical && (
          <>
            <ChevronRight size={14} />
            <span className={vc?.text}>{verticalLabels[selectedVertical]}</span>
          </>
        )}
        {selectedCity && (
          <>
            <ChevronRight size={14} />
            <span className="text-slate-700">{selectedCity}</span>
          </>
        )}
        {selectedStore && data?.storeName && (
          <>
            <ChevronRight size={14} />
            <span className="text-slate-700">{data.storeName}</span>
          </>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-slate-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Filters</span>
        </div>

        {storesLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
            <Loader2 className="animate-spin" size={14} /> Loading stores…
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            {/* Vertical */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Vertical</label>
              <div className="flex gap-1.5">
                {verticals.map((v) => {
                  const c = verticalColors[v];
                  const active = selectedVertical === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleVerticalChange(v)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        active
                          ? `${c?.bg} ${c?.border} ${c?.text} shadow-sm`
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${active ? c?.dot : "bg-slate-300"}`} />
                      {verticalLabels[v]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* City */}
            {selectedVertical && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <MapPin size={11} /> City
                </label>
                <select
                  value={selectedCity}
                  onChange={(e) => handleCityChange(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm min-w-[160px] focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                >
                  <option value="">Select city…</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Store (optional drill-down) */}
            {selectedCity && cityStores.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <Store size={11} /> Store <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <select
                  value={selectedStore}
                  onChange={(e) => handleStoreChange(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm min-w-[200px] focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                >
                  <option value="">All stores in {selectedCity}</option>
                  {cityStores.map((s) => (
                    <option key={s.storeCode} value={s.storeCode}>
                      {s.storeName} ({s.storeCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Divider */}
            {selectedCity && <div className="hidden sm:block w-px h-10 bg-slate-200" />}

            {/* Month */}
            {selectedCity && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <Calendar size={11} /> Period
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={setThisMonth}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    This month
                  </button>
                  <button
                    type="button"
                    onClick={setLastMonth}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Last month
                  </button>
                  <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                  >
                    {monthOptions.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Empty state ── */}
      {!selectedVertical && !loading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-12 text-center">
          <Trophy size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-500">Select a vertical to get started</p>
          <p className="text-xs text-slate-400 mt-1">Then pick a city to see the sales leaderboard</p>
        </div>
      )}

      {selectedVertical && !selectedCity && !loading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-12 text-center">
          <MapPin size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-500">Select a city</p>
          <p className="text-xs text-slate-400 mt-1">
            {cities.length} {cities.length === 1 ? "city" : "cities"} with {verticalLabels[selectedVertical]} stores
          </p>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
          <Loader2 className="animate-spin" size={18} /> Loading leaderboard…
        </div>
      )}

      {/* ── Error ── */}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
      )}

      {/* ── Results ── */}
      {data && !loading && (
        <>
          {/* Summary bar */}
          <div className={`rounded-xl border ${vc?.border ?? "border-blue-100"} ${vc?.bg ?? "bg-blue-50/60"} px-4 py-3 space-y-1`}>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
              <Trophy size={16} className="text-amber-500 shrink-0" />
              <span className="font-semibold">
                {data.scope === "store"
                  ? `Store leaderboard — ${data.storeName} (${data.storeCode})`
                  : `City leaderboard — ${data.city}`}
              </span>
              <span className="text-slate-400">·</span>
              <span className={vc?.text}>{verticalLabels[data.vertical] ?? data.vertical}</span>
              <span className="text-slate-400">·</span>
              <span className="font-medium">{data.period.label}</span>
              <span className="text-slate-400 text-xs">
                ({data.period.startDate} → {data.period.endDate})
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-600 mt-1">
              <span><strong>{data.leaderboard.length}</strong> employees</span>
              <span>
                <strong>{formatInr(data.leaderboard.reduce((s, r) => s + r.totalSales, 0))}</strong> total sales
              </span>
              <span>
                <strong>{formatNumber(data.leaderboard.reduce((s, r) => s + r.transactionCount, 0))}</strong> transactions
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 w-16">Rank</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Role</th>
                  {data.scope === "city" && <th className="px-4 py-3">Store</th>}
                  <th className="px-4 py-3 text-right">Transactions</th>
                  <th className="px-4 py-3 text-right">Total sales (gross)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={data.scope === "city" ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                      No sales data for this period
                    </td>
                  </tr>
                )}
                {data.leaderboard.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-2.5">
                      <RankBadge rank={row.rank} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{row.employeeName}</div>
                      <div className="text-xs text-slate-400 font-mono">{row.employeeId}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.role}</td>
                    {data.scope === "city" && (
                      <td className="px-4 py-2.5 text-slate-600">
                        <div className="text-xs">{row.storeName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{row.storeCode}</div>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {formatNumber(row.transactionCount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {formatInr(row.totalSales)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* API note */}
          <p className="text-xs text-slate-500 max-w-3xl">
            <strong>API:</strong>{" "}
            <code className="bg-slate-100 px-1 rounded">
              GET /api/leaderboard?vertical=ELECTRONICS&amp;city=Bijapur&amp;month=yyyy-MM
            </code>
            {" "}Add{" "}
            <code className="bg-slate-100 px-1 rounded">storeCode=3675</code>
            {" "}to drill into a specific store.
          </p>
        </>
      )}
    </div>
  );
}
