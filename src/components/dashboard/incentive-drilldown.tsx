"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { ChevronRight, Loader2, ArrowLeft, TrendingUp, Users, MapPin, Store, Briefcase, User, ShoppingBag, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { formatInr, formatNumber } from "@/lib/format";

type Breadcrumb = { label: string; params: Record<string, string> };

export const IncentiveDrilldown = forwardRef<
  { drillToStore: (storeCode: string, storeName: string) => void },
  { vertical: string; month?: string }
>(function IncentiveDrilldown({ vertical, month }, ref) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [crumbs, setCrumbs] = useState<Breadcrumb[]>([{ label: "All Cities", params: {} }]);

  const load = useCallback((p: Record<string, string>, v: string, m?: string) => {
    setLoading(true);
    const extra: Record<string, string> = {};
    if (v) extra.vertical = v;
    if (m) {
      const anchor = new Date(m + "-15");
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      extra.periodStart = start.toISOString().slice(0, 10);
      extra.periodEnd = end.toISOString().slice(0, 10);
    }
    const qs = new URLSearchParams({ ...p, ...extra }).toString();
    fetch(`/api/incentives?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(params, vertical, month); }, [params, vertical, month, load]);

  useEffect(() => {
    setCrumbs([{ label: "All Cities", params: {} }]);
    setParams({});
  }, [vertical]);

  const drillTo = (label: string, newParams: Record<string, string>) => {
    setCrumbs((prev) => [...prev, { label, params: newParams }]);
    setParams(newParams);
  };

  const goBack = () => {
    setCrumbs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      setParams(next[next.length - 1].params);
      return next;
    });
  };

  const goTo = (idx: number) => {
    setCrumbs((prev) => {
      const next = prev.slice(0, idx + 1);
      setParams(next[next.length - 1].params);
      return next;
    });
  };

  // Expose drillToStore for parent (below-threshold click)
  useImperativeHandle(ref, () => ({
    drillToStore(storeCode: string, storeName: string) {
      const newParams = { storeCode };
      setCrumbs([{ label: "All Cities", params: {} }, { label: storeName, params: newParams }]);
      setParams(newParams);
    },
  }));

  const level = (data as { level?: string })?.level;

  return (
    <div className="space-y-4">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
        {crumbs.length > 1 && (
          <button onClick={goBack} className="mr-1 p-1 rounded hover:bg-slate-200 text-slate-400"><ArrowLeft size={14} /></button>
        )}
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-slate-300" />}
            <button
              onClick={() => goTo(i)}
              className={`hover:text-blue-600 transition-colors ${i === crumbs.length - 1 ? "text-slate-900 font-medium" : "text-slate-500"}`}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      {loading && <div className="flex items-center gap-2 py-12 justify-center text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading...</div>}

      {!loading && data && level === "city" && <CityView data={data} onDrill={drillTo} />}
      {!loading && data && level === "store" && <StoreView data={data} onDrill={drillTo} />}
      {!loading && data && level === "storeDetail" && <StoreDetailView data={data} onDrill={drillTo} />}
      {!loading && data && level === "employeeDetail" && <EmployeeDetailView data={data} />}
    </div>
  );
});

// ── Stat card helper ──
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 flex items-center gap-3">
      <div className="rounded-md bg-slate-100 p-2 text-slate-500">{icon}</div>
      <div><p className="text-xs text-slate-500">{label}</p><p className={`text-lg font-semibold ${accent ?? "text-slate-900"}`}>{value}</p></div>
    </div>
  );
}

function AchievementBar({ pct }: { pct: number }) {
  const clamp = Math.min(pct, 150);
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 85 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 relative">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(100, (clamp / 150) * 100)}%` }} />
      <div className="absolute top-0 left-[66.7%] w-px h-2 bg-slate-300" title="100%" />
    </div>
  );
}

// ── Sortable column header ──
type SortDir = "asc" | "desc" | null;
function SortHeader({ label, active, dir, onClick, className }: { label: string; active: boolean; dir: SortDir; onClick: () => void; className?: string }) {
  return (
    <th className={`p-3 cursor-pointer select-none hover:bg-slate-100 transition-colors ${className ?? ""}`} onClick={onClick}>
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {active ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="text-slate-300" />}
      </div>
    </th>
  );
}

function useSortable<T>(rows: T[], defaultKey?: keyof T, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<keyof T | null>(defaultKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "desc" ? "asc" : prev === "asc" ? null : "desc"));
      if (sortDir === "asc") setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = sortKey && sortDir
    ? [...rows].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      })
    : rows;

  return { sorted, sortKey, sortDir, toggle };
}

// ── Level 1: Cities ──
function CityView({ data, onDrill }: { data: Record<string, unknown>; onDrill: (label: string, p: Record<string, string>) => void }) {
  const summary = data.summary as { totalIncentive: number; totalEmployees: number; employeesEarning: number; totalSales: number; storeCount: number };
  const rows = data.rows as Array<{ city: string; state: string; storeCount: number; employeeCount: number; totalEmployees: number; totalSales: number; totalIncentive: number; avgAchievementPct: number }>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<ShoppingBag size={16} />} label="Total Sales (MTD)" value={formatInr(summary.totalSales)} />
        <Stat icon={<TrendingUp size={16} />} label="Total Incentive (MTD)" value={formatInr(summary.totalIncentive)} />
        <Stat icon={<Users size={16} />} label="Associates Earning" value={`${formatNumber(summary.employeesEarning)} of ${formatNumber(summary.totalEmployees)}`} />
        <Stat icon={<Store size={16} />} label="Stores" value={formatNumber(summary.storeCount)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <button key={r.city} onClick={() => onDrill(r.city, { city: r.city })}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-slate-400" />
                <span className="font-medium text-slate-900">{r.city}</span>
                <span className="text-xs text-slate-400">{r.state}</span>
              </div>
              <ChevronRight size={14} className="text-slate-300" />
            </div>
            <div className="space-y-2">
              <AchievementBar pct={r.avgAchievementPct} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">Sales MTD</span><span className="font-medium text-slate-700">{formatInr(r.totalSales)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Incentive</span><span className="font-medium text-emerald-700">{formatInr(r.totalIncentive)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Stores</span><span className="font-medium text-slate-700">{r.storeCount}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Earning</span><span className="font-medium text-slate-700">{r.employeeCount} of {r.totalEmployees}</span></div>
              </div>
              <p className="text-xs text-slate-400">Avg achievement: {r.avgAchievementPct}%</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Level 2: Stores ──
type StoreRow = { storeCode: string; storeName: string; vertical: string; storeFormat: string; employeeCount: number; totalIncentive: number; achievementPct: number; target: number; actual: number };
function StoreView({ data, onDrill }: { data: Record<string, unknown>; onDrill: (label: string, p: Record<string, string>) => void }) {
  const summary = data.summary as { city: string; totalIncentive: number; storeCount: number };
  const rows = data.rows as StoreRow[];
  const { sorted, sortKey, sortDir, toggle } = useSortable<StoreRow>(rows, "totalIncentive");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat icon={<MapPin size={16} />} label="City" value={summary.city} />
        <Stat icon={<TrendingUp size={16} />} label="Total Incentive" value={formatInr(summary.totalIncentive)} />
        <Stat icon={<Store size={16} />} label="Stores" value={formatNumber(summary.storeCount)} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr>
            <th className="p-3 text-left">Store</th>
            <th className="p-3 text-left">Vertical</th>
            <SortHeader label="Target" active={sortKey === "target"} dir={sortKey === "target" ? sortDir : null} onClick={() => toggle("target")} className="text-right" />
            <SortHeader label="Actual" active={sortKey === "actual"} dir={sortKey === "actual" ? sortDir : null} onClick={() => toggle("actual")} className="text-right" />
            <SortHeader label="Achievement" active={sortKey === "achievementPct"} dir={sortKey === "achievementPct" ? sortDir : null} onClick={() => toggle("achievementPct")} className="text-center" />
            <SortHeader label="Incentive" active={sortKey === "totalIncentive"} dir={sortKey === "totalIncentive" ? sortDir : null} onClick={() => toggle("totalIncentive")} className="text-right" />
            <SortHeader label="Employees" active={sortKey === "employeeCount"} dir={sortKey === "employeeCount" ? sortDir : null} onClick={() => toggle("employeeCount")} className="text-center" />
            <th className="p-3 w-6"></th>
          </tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.storeCode} onClick={() => onDrill(r.storeName, { storeCode: r.storeCode })}
                className="border-t border-slate-100 hover:bg-blue-50/50 cursor-pointer transition-colors">
                <td className="p-3"><p className="font-medium text-slate-900">{r.storeName}</p><p className="text-xs text-slate-400">{r.storeCode} · {r.storeFormat}</p></td>
                <td className="p-3 text-xs">{r.vertical}</td>
                <td className="p-3 text-right">{formatInr(r.target)}</td>
                <td className="p-3 text-right">{formatInr(r.actual)}</td>
                <td className="p-3"><div className="flex items-center gap-2"><AchievementBar pct={r.achievementPct} /><span className="text-xs font-medium w-12 text-right">{r.achievementPct}%</span></div></td>
                <td className="p-3 text-right font-medium">{formatInr(r.totalIncentive)}</td>
                <td className="p-3 text-center">{r.employeeCount}</td>
                <td className="p-3"><ChevronRight size={14} className="text-slate-300" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Level 3: Store Detail (departments + employees) ──
type EmpRow = { employeeId: string; employeeName: string; role: string; baseIncentive: number; multiplierPct: number; achievementPct: number; finalIncentive: number };
function StoreDetailView({ data, onDrill }: { data: Record<string, unknown>; onDrill: (label: string, p: Record<string, string>) => void }) {
  const summary = data.summary as { storeCode: string; storeName: string; vertical: string; totalIncentive: number; employeeCount: number; totalEmployees: number };
  const departments = data.departments as Array<{ department: string; vertical: string; target: number; actual: number; achievementPct: number }>;
  const employees = data.employees as EmpRow[];
  const { sorted, sortKey, sortDir, toggle } = useSortable<EmpRow>(employees, "finalIncentive");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<Store size={16} />} label="Store" value={summary.storeName ?? summary.storeCode} />
        <Stat icon={<Briefcase size={16} />} label="Vertical" value={summary.vertical} />
        <Stat icon={<TrendingUp size={16} />} label="Total Incentive" value={formatInr(summary.totalIncentive)} accent="text-emerald-700" />
        <Stat icon={<Users size={16} />} label="Earning / Total" value={`${formatNumber(summary.employeeCount)} of ${formatNumber(summary.totalEmployees ?? summary.employeeCount)}`} />
      </div>

      {departments.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h3 className="text-sm font-medium text-slate-700">Department Targets & Achievement</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr>
              <th className="p-3 text-left">Department</th><th className="p-3 text-right">Target</th><th className="p-3 text-right">Actual</th>
              <th className="p-3 text-center">Achievement</th>
            </tr></thead>
            <tbody>
              {departments.map((r) => (
                <tr key={r.department} className="border-t border-slate-100">
                  <td className="p-3 font-medium text-slate-900">{r.department}</td>
                  <td className="p-3 text-right">{formatInr(r.target)}</td>
                  <td className="p-3 text-right">{formatInr(r.actual)}</td>
                  <td className="p-3"><div className="flex items-center gap-2"><AchievementBar pct={r.achievementPct} /><span className="text-xs font-medium w-12 text-right">{r.achievementPct}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-medium text-slate-700">Employee Incentives</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr>
            <th className="p-3 text-left">Employee</th>
            <th className="p-3 text-left">Role</th>
            <SortHeader label="Base Incentive" active={sortKey === "baseIncentive"} dir={sortKey === "baseIncentive" ? sortDir : null} onClick={() => toggle("baseIncentive")} className="text-right" />
            <SortHeader label="Multiplier" active={sortKey === "multiplierPct"} dir={sortKey === "multiplierPct" ? sortDir : null} onClick={() => toggle("multiplierPct")} className="text-right" />
            <SortHeader label="Final Incentive" active={sortKey === "finalIncentive"} dir={sortKey === "finalIncentive" ? sortDir : null} onClick={() => toggle("finalIncentive")} className="text-right" />
            <th className="p-3 w-6"></th>
          </tr></thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-slate-400">No incentive data for this period</td></tr>
            )}
            {sorted.map((r) => (
              <tr key={r.employeeId} onClick={() => onDrill(r.employeeName, { employeeId: r.employeeId })}
                className="border-t border-slate-100 hover:bg-blue-50/50 cursor-pointer transition-colors">
                <td className="p-3"><p className="font-medium text-slate-900">{r.employeeName}</p><p className="text-xs text-slate-400">{r.employeeId}</p></td>
                <td className="p-3">{r.role}</td>
                <td className="p-3 text-right">{formatInr(r.baseIncentive)}</td>
                <td className="p-3 text-right">{r.multiplierPct > 0 ? `${r.multiplierPct}%` : "\u2014"}</td>
                <td className="p-3 text-right font-semibold text-emerald-700">{formatInr(r.finalIncentive)}</td>
                <td className="p-3"><ChevronRight size={14} className="text-slate-300" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Level 5: Employee detail card ──
function EmployeeDetailView({ data }: { data: Record<string, unknown> }) {
  const emp = data.employee as { employeeId: string; employeeName: string; role: string; storeCode: string; storeName: string } | undefined;
  const vertical = data.vertical as string;
  const message = data.message as string;
  const period = data.period as { start: string; end: string };

  if (!emp) return <p className="text-sm text-slate-500">Employee not found.</p>;

  const firstName = emp.employeeName.split(" ")[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
            {emp.employeeName.split(" ").map((w) => w[0]).join("").slice(0, 2)}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{emp.employeeName}</h3>
            <p className="text-xs text-slate-500">{emp.role} · {emp.storeCode} — {emp.storeName} · {period.start} to {period.end}</p>
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">{message}</div>
      </div>

      {vertical === "ELECTRONICS" && <ElectronicsDetail data={data} firstName={firstName} />}
      {vertical === "GROCERY" && <GroceryDetail data={data} firstName={firstName} />}
      {vertical === "FNL" && <FnlDetail data={data} firstName={firstName} />}
    </div>
  );
}

type SaleItem = { date: string; brand: string; productFamily: string; articleCode: string; quantity: number; unitPrice: number; grossAmount: number; incentiveEarned: number };

function ElectronicsDetail({ data, firstName }: { data: Record<string, unknown>; firstName: string }) {
  const standing = data.currentStanding as { departmentTarget?: number; departmentActual?: number; storeTarget: number; storeActual: number; achievementPct: number; currentMultiplierPct: number; baseIncentive: number; finalIncentive: number; employeeDepartment?: string } | null;
  const tiers = data.multiplierTiers as Array<{ from: number; to: number; multiplierPct: number; isCurrentTier: boolean; incentiveAtTier: number }>;
  const departments = data.departments as Array<{ department: string; target: number; actual: number; achievementPct: number }> | undefined;
  const sales = data.recentSales as SaleItem[] | undefined;
  if (!standing) return null;

  const target = standing.departmentTarget ?? standing.storeTarget;
  const actual = standing.departmentActual ?? standing.storeActual;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<TrendingUp size={16} />} label={standing.employeeDepartment ? "Dept Achievement" : "Store Achievement"} value={`${standing.achievementPct}%`} />
        <Stat icon={<TrendingUp size={16} />} label="Multiplier" value={`${standing.currentMultiplierPct}%`} />
        <Stat icon={<TrendingUp size={16} />} label="Base Incentive" value={formatInr(standing.baseIncentive)} />
        <Stat icon={<TrendingUp size={16} />} label="Final Incentive" value={formatInr(standing.finalIncentive)} accent="text-emerald-700" />
      </div>

      {/* Incentive calculation explainer */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">How {firstName}&apos;s incentive is calculated</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>1. Each product sold earns a <strong>per-unit incentive</strong> based on its product family, brand, and price slab.</p>
          <p>2. Total per-unit incentives sum to <strong>Base Incentive: {formatInr(standing.baseIncentive)}</strong></p>
          <p>3. {standing.employeeDepartment ? `${standing.employeeDepartment} department` : "Store"} achievement is <strong>{standing.achievementPct}%</strong>, which unlocks a <strong>{standing.currentMultiplierPct}% multiplier</strong></p>
          <p>4. <strong>Final = Base × Multiplier = {formatInr(standing.baseIncentive)} × {standing.currentMultiplierPct}% = {formatInr(standing.finalIncentive)}</strong></p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-1">{standing.employeeDepartment ? "Department" : "Store"} Progress</h4>
        <p className="text-xs text-slate-500 mb-3">Target: {formatInr(target)} | Actual: {formatInr(actual)}</p>
        <AchievementBar pct={standing.achievementPct} />
      </div>

      {/* Per-product sales breakdown */}
      {sales && sales.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <ShoppingBag size={14} className="text-slate-500" />
            <h4 className="text-sm font-medium text-slate-700">{firstName}&apos;s Sales & Incentive Breakdown</h4>
            <span className="text-xs text-slate-400 ml-auto">{sales.length} transactions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2.5 text-left">Date</th>
                <th className="p-2.5 text-left">Product Family</th>
                <th className="p-2.5 text-left">Brand</th>
                <th className="p-2.5 text-right">Unit Price</th>
                <th className="p-2.5 text-center">Qty</th>
                <th className="p-2.5 text-right">Per-Unit Incentive</th>
                <th className="p-2.5 text-right">Total Incentive</th>
              </tr></thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2.5 text-xs text-slate-500">{s.date}</td>
                    <td className="p-2.5 font-medium">{s.productFamily}</td>
                    <td className="p-2.5">{s.brand}</td>
                    <td className="p-2.5 text-right">{formatInr(s.unitPrice)}</td>
                    <td className="p-2.5 text-center">{s.quantity}</td>
                    <td className="p-2.5 text-right">{s.incentiveEarned > 0 ? formatInr(Math.round(s.incentiveEarned / s.quantity)) : "\u2014"}</td>
                    <td className="p-2.5 text-right font-medium text-emerald-700">{s.incentiveEarned > 0 ? formatInr(s.incentiveEarned) : <span className="text-slate-400">{"\u20B9"}0</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="border-t-2 border-slate-200">
                  <td colSpan={6} className="p-2.5 text-right font-semibold text-slate-700">Total Base Incentive</td>
                  <td className="p-2.5 text-right font-bold text-emerald-700">{formatInr(sales.reduce((s, r) => s + r.incentiveEarned, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {departments && departments.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="font-medium text-slate-900 mb-3">Department Breakdown</h4>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Department</th><th className="p-2 text-right">Target</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">Achievement</th></tr></thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2 font-medium">{d.department}</td>
                  <td className="p-2 text-right">{formatInr(d.target)}</td>
                  <td className="p-2 text-right">{formatInr(d.actual)}</td>
                  <td className="p-2 text-right">{d.achievementPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-3">Multiplier Tiers</h4>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Achievement Range</th><th className="p-2 text-right">Multiplier</th><th className="p-2 text-right">{firstName}&apos;s Incentive</th></tr></thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i} className={`border-t border-slate-100 ${t.isCurrentTier ? "bg-blue-50 font-medium" : ""}`}>
                <td className="p-2">{t.from}% — {t.to >= 999 ? "& above" : `${t.to}%`}{t.isCurrentTier && <span className="ml-2 text-xs text-blue-600 font-semibold">CURRENT</span>}</td>
                <td className="p-2 text-right">{t.multiplierPct}%</td>
                <td className="p-2 text-right">{formatInr(t.incentiveAtTier)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GroceryDetail({ data, firstName }: { data: Record<string, unknown>; firstName: string }) {
  const standing = data.currentStanding as { campaignName: string; storeTarget: number; storeActual: number; achievementPct: number; totalPiecesSold: number; currentRate: number; totalStorePayout: number; employeeCount: number; yourPayout: number } | null;
  const slabs = data.payoutSlabs as Array<{ from: number; to: number; rate: number; isCurrentSlab: boolean; payoutAtSlab: number }>;
  const sales = data.recentSales as Array<{ date: string; brand: string; articleCode: string; description: string; quantity: number; grossAmount: number }> | undefined;
  if (!standing) return null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<Store size={16} />} label="Campaign" value={standing.campaignName} />
        <Stat icon={<TrendingUp size={16} />} label="Achievement" value={`${standing.achievementPct}%`} />
        <Stat icon={<Users size={16} />} label="Pieces Sold" value={formatNumber(standing.totalPiecesSold)} />
        <Stat icon={<TrendingUp size={16} />} label={`${firstName}'s Payout`} value={formatInr(standing.yourPayout)} accent="text-emerald-700" />
      </div>

      {/* Calculation explainer */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h4 className="text-sm font-semibold text-emerald-900 mb-2">How {firstName}&apos;s incentive is calculated</h4>
        <div className="text-sm text-emerald-800 space-y-1">
          <p>1. Store must achieve <strong>100%+</strong> of campaign target to unlock incentives</p>
          <p>2. Achievement: <strong>{formatInr(standing.storeActual)} / {formatInr(standing.storeTarget)} = {standing.achievementPct}%</strong></p>
          <p>3. At this level, rate = <strong>{"\u20B9"}{standing.currentRate}/piece</strong> × {standing.totalPiecesSold} pieces = <strong>{formatInr(Math.round(standing.currentRate * standing.totalPiecesSold))} total pool</strong></p>
          <p>4. Split equally among {standing.employeeCount} employees → <strong>{firstName}&apos;s share: {formatInr(standing.yourPayout)}</strong></p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-1">Store Progress</h4>
        <p className="text-xs text-slate-500 mb-3">Target: {formatInr(standing.storeTarget)} | Actual: {formatInr(standing.storeActual)} | Rate: {"\u20B9"}{standing.currentRate}/piece | Split among {standing.employeeCount} employees</p>
        <AchievementBar pct={standing.achievementPct} />
      </div>

      {/* Sales breakdown */}
      {sales && sales.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <ShoppingBag size={14} className="text-slate-500" />
            <h4 className="text-sm font-medium text-slate-700">{firstName}&apos;s Sales</h4>
            <span className="text-xs text-slate-400 ml-auto">{sales.length} items</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2.5 text-left">Date</th>
                <th className="p-2.5 text-left">Product</th>
                <th className="p-2.5 text-left">Brand</th>
                <th className="p-2.5 text-center">Qty</th>
                <th className="p-2.5 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2.5 text-xs text-slate-500">{s.date}</td>
                    <td className="p-2.5"><p className="font-medium">{s.description || s.articleCode}</p></td>
                    <td className="p-2.5">{s.brand}</td>
                    <td className="p-2.5 text-center">{s.quantity}</td>
                    <td className="p-2.5 text-right font-medium">{formatInr(s.grossAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="border-t-2 border-slate-200">
                  <td colSpan={3} className="p-2.5 text-right font-semibold text-slate-700">Total</td>
                  <td className="p-2.5 text-center font-semibold">{sales.reduce((s, r) => s + r.quantity, 0)}</td>
                  <td className="p-2.5 text-right font-bold">{formatInr(sales.reduce((s, r) => s + r.grossAmount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-3">Payout Slabs</h4>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Achievement Range</th><th className="p-2 text-right">Rate/Piece</th><th className="p-2 text-right">{firstName}&apos;s Share</th></tr></thead>
          <tbody>
            {slabs.map((s, i) => (
              <tr key={i} className={`border-t border-slate-100 ${s.isCurrentSlab ? "bg-emerald-50 font-medium" : ""}`}>
                <td className="p-2">{s.from}% — {s.to >= 999 ? "& above" : `${s.to}%`}{s.isCurrentSlab && <span className="ml-2 text-xs text-emerald-600 font-semibold">CURRENT</span>}</td>
                <td className="p-2 text-right">{"\u20B9"}{s.rate}</td>
                <td className="p-2 text-right">{formatInr(s.payoutAtSlab)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FnlDetail({ data, firstName }: { data: Record<string, unknown>; firstName: string }) {
  const standing = data.currentStanding as { weeklyTarget: number; weeklyActual: number; achievementPct: number; exceeded: boolean; storePool: number; roleSplit: { saPoolPct: number; smSharePct: number; dmSharePerDmPct: number }; eligibleSAs: number; yourAttendanceDays: number; attendanceEligible: boolean; yourPayout: number } | null;
  const whatIf = data.whatIf as { ifNotExceeded: string; ifMoreSales: string } | undefined;
  const weeks = data.weeks as Array<{ periodStart: string; periodEnd: string; payout: number; actualSales: number; targetValue: number }> | undefined;
  if (!standing) return null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<TrendingUp size={16} />} label="Achievement" value={`${standing.achievementPct}%`} />
        <Stat icon={<TrendingUp size={16} />} label="Store Pool" value={standing.exceeded ? formatInr(standing.storePool) : "\u20B90"} />
        <Stat icon={<User size={16} />} label="Attendance" value={`${standing.yourAttendanceDays} days ${standing.attendanceEligible ? "\u2713" : "\u2717"}`} />
        <Stat icon={<TrendingUp size={16} />} label={`${firstName}'s Payout`} value={formatInr(standing.yourPayout)} accent="text-emerald-700" />
      </div>

      {/* Calculation explainer */}
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <h4 className="text-sm font-semibold text-violet-900 mb-2">How {firstName}&apos;s incentive is calculated</h4>
        <div className="text-sm text-violet-800 space-y-1">
          <p>1. Store must <strong>exceed</strong> the weekly target to create an incentive pool</p>
          <p>2. Pool = 1% of actual sales = <strong>{standing.exceeded ? formatInr(standing.storePool) : "\u20B90 (target not met)"}</strong></p>
          <p>3. Pool is split by role: SA {standing.roleSplit.saPoolPct}% · SM {standing.roleSplit.smSharePct}% · DM {standing.roleSplit.dmSharePerDmPct}%/DM</p>
          <p>4. Need <strong>min 5 PRESENT days</strong> to be eligible. {firstName} has {standing.yourAttendanceDays} → <strong>{standing.attendanceEligible ? "Eligible" : "Not eligible"}</strong></p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-1">Store Weekly Progress</h4>
        <p className="text-xs text-slate-500 mb-3">Target: {formatInr(standing.weeklyTarget)} | Actual: {formatInr(standing.weeklyActual)} | {standing.exceeded ? "Target EXCEEDED" : "Target NOT met"}</p>
        <AchievementBar pct={standing.achievementPct} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-3">Pool Breakdown</h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500 text-xs">SA Pool</p><p className="font-semibold">{standing.roleSplit.saPoolPct}% → {formatInr(Math.round(standing.storePool * standing.roleSplit.saPoolPct / 100))}</p><p className="text-xs text-slate-400">Split among {standing.eligibleSAs} eligible SAs</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500 text-xs">SM Share</p><p className="font-semibold">{standing.roleSplit.smSharePct}% → {formatInr(Math.round(standing.storePool * standing.roleSplit.smSharePct / 100))}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500 text-xs">DM Share/DM</p><p className="font-semibold">{standing.roleSplit.dmSharePerDmPct}% → {formatInr(Math.round(standing.storePool * standing.roleSplit.dmSharePerDmPct / 100))}</p></div>
        </div>
      </div>
      {whatIf && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="font-medium text-slate-900 mb-2">What If</h4>
          <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
            <li>{whatIf.ifNotExceeded}</li>
            <li>{whatIf.ifMoreSales}</li>
          </ul>
        </div>
      )}
      {weeks && weeks.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="font-medium text-slate-900 mb-3">Weekly History</h4>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Week</th><th className="p-2 text-right">Target</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">{firstName}&apos;s Payout</th></tr></thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2">{w.periodStart} — {w.periodEnd}</td>
                  <td className="p-2 text-right">{formatInr(w.targetValue)}</td>
                  <td className="p-2 text-right">{formatInr(w.actualSales)}</td>
                  <td className="p-2 text-right font-medium">{formatInr(w.payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
