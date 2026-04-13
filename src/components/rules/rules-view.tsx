"use client";

import { useCallback, useEffect, useState } from "react";
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

export function RulesView() {
  const [active, setActive] = useState<Tab>("Electronics");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const elecPlan = plans.find((p) => p.formulaType === "PER_UNIT");
  const groPlans = plans.filter((p) => p.formulaType === "CAMPAIGN_SLAB");
  const fnlPlan = plans.find((p) => p.formulaType === "WEEKLY_POOL");

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={`px-4 py-2 text-sm rounded-lg border ${
              active === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-500">Loading rules...</p>}

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
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? "Submitting..." : "Submit for Approval"}
            </button>
          )}
        </div>
      )}

      {active === "Grocery" && (
        <div className="space-y-6">
          {groPlans.map((plan) =>
            plan.campaignConfigs.map((campaign) => (
              <div key={campaign.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{campaign.campaignName}</h3>
                    <p className="text-xs text-slate-500">
                      {campaign.startDate.slice(0, 10)} to {campaign.endDate.slice(0, 10)}
                    </p>
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
                          <td className="p-2">{a.articleCode}</td>
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
                          <td className="p-2">{st.storeCode}</td>
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

                <p className="text-xs text-slate-500 italic">Distribution: Equal among all store employees (excl. BA)</p>

                {plan.status === "DRAFT" && (
                  <button onClick={() => submitForApproval(plan.id)} disabled={saving}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {saving ? "Submitting..." : "Submit for Approval"}
                  </button>
                )}
              </div>
            )),
          )}
          {!loading && groPlans.length === 0 && (
            <p className="text-sm text-slate-500">No Grocery campaign plans configured.</p>
          )}
        </div>
      )}

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
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? "Submitting..." : "Submit for Approval"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
