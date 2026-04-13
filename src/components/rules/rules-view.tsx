"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Package, ShoppingCart, Shirt } from "lucide-react";
import { formatInr } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";

type Plan = {
  id: number;
  planName: string;
  vertical: string;
  formulaType: string;
  status: string;
  productIncentiveSlabs: Slab[];
  achievementMultipliers: Multiplier[];
  campaignConfigs: Campaign[];
  fnlRoleSplits: RoleSplit[];
  config: Record<string, unknown> | null;
};

type Slab = {
  id: number;
  productFamily: string;
  brandFilter: string;
  priceFrom: number;
  priceTo: number;
  incentivePerUnit: number;
  effectiveFrom: string | null;
};

type Multiplier = {
  id: number;
  achievementFrom: number;
  achievementTo: number;
  multiplierPct: number;
};

type Campaign = {
  id: number;
  campaignName: string;
  startDate: string;
  endDate: string;
  status: string;
  articles: { articleCode: string; brand: string; description: string }[];
  storeTargets: { storeCode: string; targetValue: number; store: { storeName: string } }[];
  payoutSlabs: { achievementFrom: number; achievementTo: number; perPieceRate: number }[];
};

type RoleSplit = {
  numSms: number;
  numDms: number;
  saPoolPct: number;
  smSharePct: number;
  dmSharePerDmPct: number;
};

const tabs = ["Electronics", "Grocery", "F&L"] as const;
type Tab = (typeof tabs)[number];
const tabToVertical: Record<Tab, string> = { Electronics: "ELECTRONICS", Grocery: "GROCERY", "F&L": "FNL" };
const tabIcons: Record<Tab, React.ReactNode> = {
  Electronics: <Package size={16} />,
  Grocery: <ShoppingCart size={16} />,
  "F&L": <Shirt size={16} />,
};

function EmptyState({ tab, onSeed }: { tab: Tab; onSeed: () => void; }) {
  const descriptions: Record<Tab, { title: string; body: string }> = {
    Electronics: {
      title: "No Electronics incentive plan configured",
      body: "Set up per-product incentive slabs and achievement multipliers for Reliance Digital stores. The plan defines how much incentive each Sales Associate earns per unit sold, adjusted by department-level target achievement.",
    },
    Grocery: {
      title: "No Grocery campaign plans configured",
      body: "Create campaign-based incentive slabs for Smart/Signature stores. Define eligible articles, store targets, and per-piece payout rates. Incentive is distributed equally among SM, DM, and SA roles.",
    },
    "F&L": {
      title: "No F&L pool configuration found",
      body: "Configure the weekly store pool for Trends/TST stores. The pool is a percentage of actual weekly sales (when target is exceeded), split by role based on the SM/DM count at each store.",
    },
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {tabIcons[tab]}
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-2">{descriptions[tab].title}</h3>
      <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">{descriptions[tab].body}</p>
      <button onClick={onSeed}
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
        Load Demo Data with Pre-configured Rules
      </button>
      <p className="text-xs text-slate-400 mt-2">This will populate 15 stores, employees, sales data, and all incentive rules</p>
    </div>
  );
}

export function RulesView() {
  const [active, setActive] = useState<Tab>("Electronics");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/rules?vertical=${tabToVertical[active]}`)
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, [active]);

  useEffect(() => { load(); }, [load]);

  const submitForApproval = async (planId: number) => {
    setSaving(true);
    await fetch("/api/rules/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    setSaving(false);
    load();
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      if (res.ok) window.location.reload();
    } catch { /* ignore */ }
    setSeeding(false);
  };

  const elecPlan = plans.find((p) => p.formulaType === "PER_UNIT");
  const groPlans = plans.filter((p) => p.formulaType === "CAMPAIGN_SLAB");
  const fnlPlan = plans.find((p) => p.formulaType === "WEEKLY_POOL");

  const showEmpty = !loading && plans.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-colors ${
              active === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {tabIcons[t]} {t}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-12 justify-center text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading rules...
        </div>
      )}

      {seeding && (
        <div className="flex items-center gap-2 py-12 justify-center text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading demo data... This may take a moment.
        </div>
      )}

      {showEmpty && !seeding && <EmptyState tab={active} onSeed={handleSeed} />}

      {/* ── Electronics ── */}
      {active === "Electronics" && elecPlan && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900">Product Incentive Slabs</h3>
                <p className="text-xs text-slate-500 mt-1">{elecPlan.productIncentiveSlabs.length} rows configured</p>
              </div>
              <StatusBadge status={elecPlan.status} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2 text-left">Product Family</th>
                    <th className="p-2 text-left">Brand Filter</th>
                    <th className="p-2 text-right">Price From</th>
                    <th className="p-2 text-right">Price To</th>
                    <th className="p-2 text-right">Incentive/Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {elecPlan.productIncentiveSlabs.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-2">{s.productFamily}</td>
                      <td className="p-2 text-slate-600">{s.brandFilter}</td>
                      <td className="p-2 text-right">{formatInr(Number(s.priceFrom))}</td>
                      <td className="p-2 text-right">{Number(s.priceTo) >= 999999 ? "& above" : formatInr(Number(s.priceTo))}</td>
                      <td className="p-2 text-right font-medium">{formatInr(Number(s.incentivePerUnit))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Achievement Multiplier</h3>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 text-right">Achievement From %</th>
                  <th className="p-2 text-right">Achievement To %</th>
                  <th className="p-2 text-right">Multiplier %</th>
                </tr>
              </thead>
              <tbody>
                {elecPlan.achievementMultipliers.map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 text-right">{Number(m.achievementFrom)}%</td>
                    <td className="p-2 text-right">{Number(m.achievementTo) >= 999 ? "& above" : `${Number(m.achievementTo)}%`}</td>
                    <td className="p-2 text-right font-medium">{Number(m.multiplierPct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Exclusions</h3>
            <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
              <li>All Apple products (across all categories)</li>
              <li>OnePlus phones</li>
              <li>Microsoft Surface laptops</li>
              <li>Transaction types: SFS, PAS, JIOMART</li>
            </ul>
          </div>

          {elecPlan.status === "DRAFT" && (
            <button onClick={() => submitForApproval(elecPlan.id)} disabled={saving}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 transition-colors">
              {saving ? "Submitting..." : "Submit for Approval"}
            </button>
          )}
        </div>
      )}

      {/* ── Grocery ── */}
      {active === "Grocery" && groPlans.length > 0 && (
        <div className="space-y-6">
          {groPlans.map((plan) =>
            plan.campaignConfigs.map((campaign) => (
              <div key={campaign.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{campaign.campaignName}</h3>
                    <p className="text-xs text-slate-500">{campaign.startDate.slice(0, 10)} to {campaign.endDate.slice(0, 10)}</p>
                  </div>
                  <StatusBadge status={campaign.status} />
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Eligible Articles ({campaign.articles.length})</h4>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2 text-left">Article Code</th>
                        <th className="p-2 text-left">Brand</th>
                        <th className="p-2 text-left">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaign.articles.map((a, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2 font-mono text-xs">{a.articleCode}</td>
                          <td className="p-2">{a.brand}</td>
                          <td className="p-2">{a.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Store Targets</h4>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2 text-left">Store Code</th>
                        <th className="p-2 text-left">Store Name</th>
                        <th className="p-2 text-right">Target Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaign.storeTargets.map((st, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2 font-mono text-xs">{st.storeCode}</td>
                          <td className="p-2">{st.store.storeName}</td>
                          <td className="p-2 text-right">{formatInr(Number(st.targetValue))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Payout Slabs</h4>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2 text-right">Achievement From %</th>
                        <th className="p-2 text-right">Achievement To %</th>
                        <th className="p-2 text-right">Per Piece Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaign.payoutSlabs.map((sl, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2 text-right">{Number(sl.achievementFrom)}%</td>
                          <td className="p-2 text-right">{Number(sl.achievementTo) >= 999 ? "& above" : `${Number(sl.achievementTo)}%`}</td>
                          <td className="p-2 text-right font-medium">{formatInr(Number(sl.perPieceRate))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-slate-500 italic">Distribution: Equal among all store employees (SM + DM + SA, excl. BA)</p>

                {plan.status === "DRAFT" && (
                  <button onClick={() => submitForApproval(plan.id)} disabled={saving}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 transition-colors">
                    {saving ? "Submitting..." : "Submit for Approval"}
                  </button>
                )}
              </div>
            )),
          )}
        </div>
      )}

      {/* ── F&L ── */}
      {active === "F&L" && fnlPlan && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Pool Configuration</h3>
              <StatusBadge status={fnlPlan.status} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Pool Percentage</p>
                <p className="text-lg font-semibold">{(fnlPlan.config as Record<string, number>)?.poolPct ?? 1}%</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Attendance Min Days</p>
                <p className="text-lg font-semibold">{(fnlPlan.config as Record<string, number>)?.attendanceMinDays ?? 5}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Week Definition</p>
                <p className="text-lg font-semibold">Sun–Sat</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Role Split Table</h3>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 text-center">SMs</th>
                  <th className="p-2 text-center">DMs</th>
                  <th className="p-2 text-right">SA Pool %</th>
                  <th className="p-2 text-right">SM Share %</th>
                  <th className="p-2 text-right">DM Share/DM %</th>
                </tr>
              </thead>
              <tbody>
                {fnlPlan.fnlRoleSplits.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 text-center">{r.numSms}</td>
                    <td className="p-2 text-center">{r.numDms}</td>
                    <td className="p-2 text-right">{Number(r.saPoolPct)}%</td>
                    <td className="p-2 text-right">{Number(r.smSharePct)}%</td>
                    <td className="p-2 text-right">{Number(r.dmSharePerDmPct) > 0 ? `${Number(r.dmSharePerDmPct)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fnlPlan.status === "DRAFT" && (
            <button onClick={() => submitForApproval(fnlPlan.id)} disabled={saving}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 transition-colors">
              {saving ? "Submitting..." : "Submit for Approval"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
