"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, subMonths, startOfMonth } from "date-fns";
import { Loader2, Trophy, Building2, MapPin, LogIn, LogOut, Calendar } from "lucide-react";
import { formatInr, formatNumber } from "@/lib/format";

const TOKEN_KEY = "incentive_os_token";

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
  isViewer: boolean;
};

type LeaderboardResponse = {
  metric: "TOTAL_SALES_GROSS";
  rankBy: "totalSales";
  scope: "store" | "city";
  vertical: string;
  verticalFilter: string;
  city: string;
  storeCode: string | null;
  storeName: string | null;
  period: LeaderboardPeriod;
  viewer: {
    employeeId: string;
    employeeName: string;
    storeCode: string;
    storeName: string;
    city: string;
    vertical: string;
    role: string;
  };
  leaderboard: LeaderboardRow[];
};

const verticalLabels: Record<string, string> = {
  ELECTRONICS: "Electronics",
  GROCERY: "Grocery",
  FNL: "Fashion & Lifestyle",
};

function rollingMonthOptions(count: number): { value: string; label: string }[] {
  const base = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = subMonths(startOfMonth(base), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
  });
}

export function LeaderboardView() {
  const [token, setToken] = useState<string | null>(null);
  const [employerId, setEmployerId] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const monthOptions = useMemo(() => rollingMonthOptions(18), []);

  const [scope, setScope] = useState<"store" | "city">("store");
  const [month, setMonth] = useState(() => format(startOfMonth(new Date()), "yyyy-MM"));
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ scope, month });
      const res = await fetch(`/api/leaderboard?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token, scope, month]);

  useEffect(() => {
    if (token) void loadLeaderboard();
  }, [token, scope, month, loadLeaderboard]);

  const setThisMonth = () => setMonth(format(startOfMonth(new Date()), "yyyy-MM"));
  const setLastMonth = () => setMonth(format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM"));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employerId: employerId.trim(), password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Login failed");
      localStorage.setItem(TOKEN_KEY, body.token);
      setToken(body.token);
      setPassword("");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setData(null);
  };

  if (!token) {
    return (
      <div className="max-w-md mx-auto rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-800 font-semibold mb-1">
          <LogIn size={18} className="text-blue-600" />
          Sign in to view leaderboard
        </div>
        <p className="text-sm text-slate-500 mb-4">
          The leaderboard API requires a JWT (same as the mobile app). Employer ID equals employee ID from seed (e.g.{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">E001</code>
          ). Password follows{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">Demo@{"{3-digit}"}{"{id length}"}</code>
          — for <code className="text-xs bg-slate-100 px-1 rounded">E001</code> use{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">Demo@00104</code>.
        </p>
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Employer ID</label>
            <input
              value={employerId}
              onChange={(e) => setEmployerId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="current-password"
            />
          </div>
          {loginError && <p className="text-sm text-red-600">{loginError}</p>}
          <button
            type="submit"
            disabled={loginBusy}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loginBusy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Scope</span>
          <button
            type="button"
            onClick={() => setScope("store")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              scope === "store" ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Building2 size={14} /> My store
          </button>
          <button
            type="button"
            onClick={() => setScope("city")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              scope === "city" ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <MapPin size={14} /> My city (same vertical)
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={setThisMonth}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            This month
          </button>
          <button
            type="button"
            onClick={setLastMonth}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Last month
          </button>
          <label className="text-xs text-slate-500 flex items-center gap-1">
            <Calendar size={12} />
            Month
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      {data?.viewer && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
          <span className="font-medium text-slate-900">Your context:</span>{" "}
          <strong>{data.viewer.employeeName}</strong>
          {" · "}
          Vertical <strong>{verticalLabels[data.viewer.vertical] ?? data.viewer.vertical}</strong>
          {" · "}
          Store <strong>{data.viewer.storeName}</strong> ({data.viewer.storeCode})
          {" · "}
          Role <strong>{data.viewer.role}</strong>
          {scope === "city" && (
            <>
              {" · "}
              City: <strong>{data.city}</strong> — only <strong>{verticalLabels[data.vertical] ?? data.vertical}</strong> stores and staff
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 className="animate-spin" size={18} /> Loading leaderboard…
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
      )}

      {data && !loading && (
        <>
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
              <Trophy size={16} className="text-amber-500 shrink-0" />
              <span className="font-semibold">Sales leaderboard</span>
              <span className="text-slate-500">·</span>
              <span>{verticalLabels[data.vertical] ?? data.vertical}</span>
              <span className="text-slate-500">·</span>
              <span>
                {scope === "store" ? data.storeName : `${data.city} (all stores in vertical)`}
              </span>
            </div>
            <div className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">{data.period.label}</span>
              {" "}
              <span className="text-slate-500">
                ({data.period.startDate} → {data.period.endDate})
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{data.period.description}</p>
            <p className="text-[11px] font-mono text-slate-500">
              metric={data.metric} rankBy={data.rankBy} verticalFilter={data.verticalFilter}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role</th>
                  {scope === "city" && <th className="px-4 py-3">Store</th>}
                  <th className="px-4 py-3 text-right">Transactions</th>
                  <th className="px-4 py-3 text-right">Total sales (gross)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.leaderboard.map((row) => (
                  <tr
                    key={row.employeeId}
                    className={row.isViewer ? "bg-blue-50/80" : "hover:bg-slate-50/80"}
                  >
                    <td className="px-4 py-2.5 font-mono text-slate-600">{row.rank}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{row.employeeName}</div>
                      <div className="text-xs text-slate-400 font-mono">{row.employeeId}</div>
                      {row.isViewer && <span className="text-[10px] font-semibold text-blue-600 uppercase">You</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.role}</td>
                    {scope === "city" && (
                      <td className="px-4 py-2.5 text-slate-600">
                        <div className="text-xs">{row.storeName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{row.storeCode}</div>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.transactionCount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatInr(row.totalSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500 max-w-3xl">
            <strong>API:</strong>{" "}
            <code className="bg-slate-100 px-1 rounded">GET /api/leaderboard?scope=store|city&amp;month=yyyy-MM</code>
            {" "}or{" "}
            <code className="bg-slate-100 px-1 rounded">monthsBack=0|1|…</code>
            {" "}when <code className="bg-slate-100 px-1 rounded">month</code> is omitted (0 = this month).{" "}
            <strong>GET /api/leaderboard/me</strong> returns your store rank and sales for the same period params.
          </p>
        </>
      )}
    </div>
  );
}
