"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Package, ShoppingCart, Shirt, Plus, Pencil, Send, Copy, Save, X, Trash2 } from "lucide-react";
import { formatInr } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";

type Plan = {
  id: number;
  planName: string;
  vertical: string;
  formulaType: string;
  status: string;
  version: number;
  rejectionReason: string | null;
  productIncentiveSlabs: Slab[];
  achievementMultipliers: Multiplier[];
  campaignConfigs: Campaign[];
  fnlRoleSplits: RoleSplit[];
  config: Record<string, unknown> | null;
};
type Slab = { id: number; productFamily: string; brandFilter: string; priceFrom: number; priceTo: number; incentivePerUnit: number; effectiveFrom: string | null };
type Multiplier = { id: number; achievementFrom: number; achievementTo: number; multiplierPct: number };
type Campaign = { id: number; campaignName: string; startDate: string; endDate: string; status: string; articles: Art[]; storeTargets: ST[]; payoutSlabs: PS[] };
type Art = { articleCode: string; brand: string; description: string };
type ST = { storeCode: string; targetValue: number; store: { storeName: string } };
type PS = { achievementFrom: number; achievementTo: number; perPieceRate: number };
type RoleSplit = { numSms: number; numDms: number; saPoolPct: number; smSharePct: number; dmSharePerDmPct: number };

const tabs = ["Electronics", "Grocery", "F&L"] as const;
type Tab = (typeof tabs)[number];
const tabToVertical: Record<Tab, string> = { Electronics: "ELECTRONICS", Grocery: "GROCERY", "F&L": "FNL" };
const tabIcons: Record<Tab, React.ReactNode> = { Electronics: <Package size={16} />, Grocery: <ShoppingCart size={16} />, "F&L": <Shirt size={16} /> };

export function RulesView() {
  const [active, setActive] = useState<Tab>("Electronics");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);

  const [editSlabs, setEditSlabs] = useState<Slab[]>([]);
  const [editMultipliers, setEditMultipliers] = useState<Multiplier[]>([]);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
  const [editRoleSplits, setEditRoleSplits] = useState<RoleSplit[]>([]);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/rules?vertical=${tabToVertical[active]}`)
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, [active]);

  useEffect(() => { load(); }, [load]);

  const cancelEdit = () => { setEditingPlanId(null); setEditSlabs([]); setEditMultipliers([]); setEditCampaign(null); setEditRoleSplits([]); };

  const startEdit = (plan: Plan) => {
    setEditingPlanId(plan.id);
    setEditSlabs(plan.productIncentiveSlabs.map((s) => ({ ...s, priceFrom: Number(s.priceFrom), priceTo: Number(s.priceTo), incentivePerUnit: Number(s.incentivePerUnit) })));
    setEditMultipliers(plan.achievementMultipliers.map((m) => ({ ...m, achievementFrom: Number(m.achievementFrom), achievementTo: Number(m.achievementTo), multiplierPct: Number(m.multiplierPct) })));
    setEditConfig(plan.config ? { ...plan.config } : { poolPct: 1, attendanceMinDays: 5 });
    setEditRoleSplits(plan.fnlRoleSplits.map((r) => ({ ...r, saPoolPct: Number(r.saPoolPct), smSharePct: Number(r.smSharePct), dmSharePerDmPct: Number(r.dmSharePerDmPct) })));
    if (plan.campaignConfigs[0]) setEditCampaign(JSON.parse(JSON.stringify(plan.campaignConfigs[0])));
  };

  const createPlan = async () => {
    setBusy(true);
    const res = await fetch("/api/rules/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vertical: tabToVertical[active] }) });
    if (res.ok) load();
    setBusy(false);
  };

  const newVersion = async (planId: number) => {
    setBusy(true);
    const res = await fetch("/api/rules/new-version", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
    if (res.ok) load();
    setBusy(false);
  };

  const submitPlan = async (planId: number) => {
    setBusy(true);
    await fetch("/api/rules/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
    setBusy(false);
    load();
  };

  const saveElectronics = async (planId: number) => {
    setBusy(true);
    await fetch("/api/rules/electronics", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, slabs: editSlabs, multipliers: editMultipliers }) });
    cancelEdit();
    setBusy(false);
    load();
  };

  const saveGrocery = async (planId: number) => {
    if (!editCampaign) return;
    setBusy(true);
    await fetch("/api/rules/grocery", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId, campaignId: editCampaign.id, campaignName: editCampaign.campaignName,
        startDate: editCampaign.startDate, endDate: editCampaign.endDate,
        articles: editCampaign.articles, storeTargets: editCampaign.storeTargets.map((t) => ({ storeCode: t.storeCode, targetValue: t.targetValue })),
        payoutSlabs: editCampaign.payoutSlabs,
      }),
    });
    cancelEdit();
    setBusy(false);
    load();
  };

  const saveFnl = async (planId: number) => {
    setBusy(true);
    await fetch("/api/rules/fnl", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, config: editConfig, roleSplits: editRoleSplits }) });
    cancelEdit();
    setBusy(false);
    load();
  };

  const elecPlan = plans.find((p) => p.formulaType === "PER_UNIT");
  const groPlans = plans.filter((p) => p.formulaType === "CAMPAIGN_SLAB");
  const fnlPlan = plans.find((p) => p.formulaType === "WEEKLY_POOL");
  const showEmpty = !loading && plans.length === 0;
  const isEditing = (id: number) => editingPlanId === id;

  function PlanActions({ plan, onSave }: { plan: Plan; onSave: () => void }) {
    const editing = isEditing(plan.id);
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={plan.status} />
        {plan.version > 1 && <span className="text-xs text-slate-400">v{plan.version}</span>}
        {plan.rejectionReason && plan.status === "DRAFT" && (
          <span className="text-xs text-red-600 bg-red-50 rounded px-2 py-0.5">Rejected: {plan.rejectionReason}</span>
        )}
        {plan.status === "ACTIVE" && !editing && (
          <button onClick={() => newVersion(plan.id)} disabled={busy} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"><Copy size={12} /> New Version</button>
        )}
        {(plan.status === "DRAFT") && !editing && (
          <>
            <button onClick={() => startEdit(plan)} disabled={busy} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 font-medium"><Pencil size={12} /> Edit</button>
            <button onClick={() => submitPlan(plan.id)} disabled={busy} className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium"><Send size={12} /> Submit for Approval</button>
          </>
        )}
        {plan.status === "SUBMITTED" && <span className="text-xs text-amber-600 italic">Pending approval...</span>}
        {editing && (
          <>
            <button onClick={onSave} disabled={busy} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"><Save size={12} /> Save</button>
            <button onClick={cancelEdit} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><X size={12} /> Cancel</button>
          </>
        )}
      </div>
    );
  }

  const updateSlab = (idx: number, field: keyof Slab, value: string | number) => {
    setEditSlabs((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };
  const addSlab = () => setEditSlabs((prev) => [...prev, { id: 0, productFamily: "", brandFilter: "All brands", priceFrom: 0, priceTo: 999999, incentivePerUnit: 0, effectiveFrom: null }]);
  const removeSlab = (idx: number) => setEditSlabs((prev) => prev.filter((_, i) => i !== idx));
  const updateMult = (idx: number, field: keyof Multiplier, value: number) => setEditMultipliers((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));

  const ic = "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none";
  const icNum = `${ic} text-right`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button key={t} onClick={() => { setActive(t); cancelEdit(); }}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-colors ${active === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}>
              {tabIcons[t]} {t}
            </button>
          ))}
        </div>
        {!showEmpty && !loading && (
          <button onClick={createPlan} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            <Plus size={14} /> Create New Plan
          </button>
        )}
      </div>

      {loading && <div className="flex items-center gap-2 py-12 justify-center text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading rules...</div>}

      {showEmpty && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{tabIcons[active]}</div>
          <h3 className="text-base font-semibold text-slate-900 mb-2">No {active} plan configured</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">Create a new incentive plan with pre-loaded defaults from the Reliance vendor brief.</p>
          <button onClick={createPlan} disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={14} className="inline mr-1" /> Create {active} Plan
          </button>
        </div>
      )}

      {/* ── ELECTRONICS ── */}
      {active === "Electronics" && elecPlan && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900">Product Incentive Slabs</h3>
                <p className="text-xs text-slate-500 mt-1">{(isEditing(elecPlan.id) ? editSlabs : elecPlan.productIncentiveSlabs).length} rows</p>
              </div>
              <PlanActions plan={elecPlan} onSave={() => saveElectronics(elecPlan.id)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600"><tr>
                  <th className="p-2 text-left">Product Family</th><th className="p-2 text-left">Brand Filter</th>
                  <th className="p-2 text-right">Price From</th><th className="p-2 text-right">Price To</th><th className="p-2 text-right">Incentive/Unit</th>
                  {isEditing(elecPlan.id) && <th className="p-2 w-8"></th>}
                </tr></thead>
                <tbody>
                  {(isEditing(elecPlan.id) ? editSlabs : elecPlan.productIncentiveSlabs).map((s, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {isEditing(elecPlan.id) ? (<>
                        <td className="p-1"><input className={ic} value={s.productFamily} onChange={(e) => updateSlab(i, "productFamily", e.target.value)} /></td>
                        <td className="p-1"><input className={ic} value={s.brandFilter} onChange={(e) => updateSlab(i, "brandFilter", e.target.value)} /></td>
                        <td className="p-1"><input className={icNum} type="number" value={s.priceFrom} onChange={(e) => updateSlab(i, "priceFrom", Number(e.target.value))} /></td>
                        <td className="p-1"><input className={icNum} type="number" value={s.priceTo} onChange={(e) => updateSlab(i, "priceTo", Number(e.target.value))} /></td>
                        <td className="p-1"><input className={icNum} type="number" value={s.incentivePerUnit} onChange={(e) => updateSlab(i, "incentivePerUnit", Number(e.target.value))} /></td>
                        <td className="p-1"><button onClick={() => removeSlab(i)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                      </>) : (<>
                        <td className="p-2">{s.productFamily}</td>
                        <td className="p-2 text-slate-600">{s.brandFilter}</td>
                        <td className="p-2 text-right">{formatInr(Number(s.priceFrom))}</td>
                        <td className="p-2 text-right">{Number(s.priceTo) >= 999999 ? "& above" : formatInr(Number(s.priceTo))}</td>
                        <td className="p-2 text-right font-medium">{formatInr(Number(s.incentivePerUnit))}</td>
                      </>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {isEditing(elecPlan.id) && (
                <button onClick={addSlab} className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2"><Plus size={12} /> Add Row</button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Achievement Multiplier</h3>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2 text-right">From %</th><th className="p-2 text-right">To %</th><th className="p-2 text-right">Multiplier %</th>
              </tr></thead>
              <tbody>
                {(isEditing(elecPlan.id) ? editMultipliers : elecPlan.achievementMultipliers).map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {isEditing(elecPlan.id) ? (<>
                      <td className="p-1"><input className={icNum} type="number" value={m.achievementFrom} onChange={(e) => updateMult(i, "achievementFrom", Number(e.target.value))} /></td>
                      <td className="p-1"><input className={icNum} type="number" value={m.achievementTo} onChange={(e) => updateMult(i, "achievementTo", Number(e.target.value))} /></td>
                      <td className="p-1"><input className={icNum} type="number" value={m.multiplierPct} onChange={(e) => updateMult(i, "multiplierPct", Number(e.target.value))} /></td>
                    </>) : (<>
                      <td className="p-2 text-right">{Number(m.achievementFrom)}%</td>
                      <td className="p-2 text-right">{Number(m.achievementTo) >= 999 ? "& above" : `${Number(m.achievementTo)}%`}</td>
                      <td className="p-2 text-right font-medium">{Number(m.multiplierPct)}%</td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Exclusions</h3>
            <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
              <li>All Apple products (across all categories)</li><li>OnePlus phones</li><li>Microsoft Surface laptops</li><li>Transaction types: SFS, PAS, JIOMART</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── GROCERY ── */}
      {active === "Grocery" && groPlans.length > 0 && (
        <div className="space-y-6">
          {groPlans.map((plan) =>
            plan.campaignConfigs.map((campaign) => {
              const editing = isEditing(plan.id);
              const c = editing && editCampaign ? editCampaign : campaign;
              return (
                <div key={campaign.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      {editing ? (
                        <input className={`${ic} text-base font-semibold`} value={c.campaignName} onChange={(e) => setEditCampaign((prev) => prev ? { ...prev, campaignName: e.target.value } : prev)} />
                      ) : (
                        <h3 className="font-semibold text-slate-900">{c.campaignName}</h3>
                      )}
                      {editing ? (
                        <div className="flex gap-2 mt-1">
                          <input type="date" className={ic} value={c.startDate.slice(0, 10)} onChange={(e) => setEditCampaign((prev) => prev ? { ...prev, startDate: e.target.value } : prev)} />
                          <input type="date" className={ic} value={c.endDate.slice(0, 10)} onChange={(e) => setEditCampaign((prev) => prev ? { ...prev, endDate: e.target.value } : prev)} />
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">{c.startDate.slice(0, 10)} to {c.endDate.slice(0, 10)}</p>
                      )}
                    </div>
                    <PlanActions plan={plan} onSave={() => saveGrocery(plan.id)} />
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-slate-700 mb-2">Eligible Articles ({c.articles.length})</h4>
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Article Code</th><th className="p-2 text-left">Brand</th><th className="p-2 text-left">Description</th>{editing && <th className="p-2 w-8"></th>}</tr></thead>
                      <tbody>
                        {c.articles.map((a, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            {editing ? (<>
                              <td className="p-1"><input className={ic} value={a.articleCode} onChange={(e) => { const arts = [...c.articles]; arts[i] = { ...arts[i], articleCode: e.target.value }; setEditCampaign((prev) => prev ? { ...prev, articles: arts } : prev); }} /></td>
                              <td className="p-1"><input className={ic} value={a.brand} onChange={(e) => { const arts = [...c.articles]; arts[i] = { ...arts[i], brand: e.target.value }; setEditCampaign((prev) => prev ? { ...prev, articles: arts } : prev); }} /></td>
                              <td className="p-1"><input className={ic} value={a.description} onChange={(e) => { const arts = [...c.articles]; arts[i] = { ...arts[i], description: e.target.value }; setEditCampaign((prev) => prev ? { ...prev, articles: arts } : prev); }} /></td>
                              <td className="p-1"><button onClick={() => { const arts = c.articles.filter((_, j) => j !== i); setEditCampaign((prev) => prev ? { ...prev, articles: arts } : prev); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                            </>) : (<>
                              <td className="p-2 font-mono text-xs">{a.articleCode}</td><td className="p-2">{a.brand}</td><td className="p-2">{a.description}</td>
                            </>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editing && (
                      <button onClick={() => setEditCampaign((prev) => prev ? { ...prev, articles: [...prev.articles, { articleCode: "", brand: "", description: "" }] } : prev)}
                        className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium px-2"><Plus size={12} /> Add Article</button>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-slate-700 mb-2">Payout Slabs</h4>
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-right">From %</th><th className="p-2 text-right">To %</th><th className="p-2 text-right">Per Piece Rate</th></tr></thead>
                      <tbody>
                        {c.payoutSlabs.map((sl, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            {editing ? (<>
                              <td className="p-1"><input className={icNum} type="number" value={sl.achievementFrom} onChange={(e) => { const slabs = [...c.payoutSlabs]; slabs[i] = { ...slabs[i], achievementFrom: Number(e.target.value) }; setEditCampaign((prev) => prev ? { ...prev, payoutSlabs: slabs } : prev); }} /></td>
                              <td className="p-1"><input className={icNum} type="number" value={sl.achievementTo} onChange={(e) => { const slabs = [...c.payoutSlabs]; slabs[i] = { ...slabs[i], achievementTo: Number(e.target.value) }; setEditCampaign((prev) => prev ? { ...prev, payoutSlabs: slabs } : prev); }} /></td>
                              <td className="p-1"><input className={icNum} type="number" value={sl.perPieceRate} onChange={(e) => { const slabs = [...c.payoutSlabs]; slabs[i] = { ...slabs[i], perPieceRate: Number(e.target.value) }; setEditCampaign((prev) => prev ? { ...prev, payoutSlabs: slabs } : prev); }} /></td>
                            </>) : (<>
                              <td className="p-2 text-right">{Number(sl.achievementFrom)}%</td>
                              <td className="p-2 text-right">{Number(sl.achievementTo) >= 999 ? "& above" : `${Number(sl.achievementTo)}%`}</td>
                              <td className="p-2 text-right font-medium">{formatInr(Number(sl.perPieceRate))}</td>
                            </>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-slate-500 italic">Distribution: Equal among all store employees (SM, DM, SA, and BA where applicable)</p>
                </div>
              );
            }),
          )}
        </div>
      )}

      {/* ── F&L ── */}
      {active === "F&L" && fnlPlan && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Pool Configuration</h3>
              <PlanActions plan={fnlPlan} onSave={() => saveFnl(fnlPlan.id)} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              {isEditing(fnlPlan.id) ? (<>
                <div className="rounded-lg bg-slate-50 p-3">
                  <label className="text-slate-500 text-xs">Pool %</label>
                  <input className={icNum} type="number" value={Number(editConfig.poolPct ?? 1)} onChange={(e) => setEditConfig((p) => ({ ...p, poolPct: Number(e.target.value) }))} />
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <label className="text-slate-500 text-xs">Min Attendance Days</label>
                  <input className={icNum} type="number" value={Number(editConfig.attendanceMinDays ?? 5)} onChange={(e) => setEditConfig((p) => ({ ...p, attendanceMinDays: Number(e.target.value) }))} />
                </div>
              </>) : (<>
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500">Pool Percentage</p><p className="text-lg font-semibold">{Number((fnlPlan.config as Record<string, number>)?.poolPct ?? 1)}%</p></div>
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500">Attendance Min Days</p><p className="text-lg font-semibold">{Number((fnlPlan.config as Record<string, number>)?.attendanceMinDays ?? 5)}</p></div>
              </>)}
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500">Week Definition</p><p className="text-lg font-semibold">Sun–Sat</p></div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Role Split Table</h3>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2 text-center">SMs</th><th className="p-2 text-center">DMs</th><th className="p-2 text-right">SA Pool %</th><th className="p-2 text-right">SM Share %</th><th className="p-2 text-right">DM Share/DM %</th>
              </tr></thead>
              <tbody>
                {(isEditing(fnlPlan.id) ? editRoleSplits : fnlPlan.fnlRoleSplits).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {isEditing(fnlPlan.id) ? (<>
                      <td className="p-1"><input className={`${ic} text-center`} type="number" value={r.numSms} onChange={(e) => setEditRoleSplits((prev) => prev.map((x, j) => j === i ? { ...x, numSms: Number(e.target.value) } : x))} /></td>
                      <td className="p-1"><input className={`${ic} text-center`} type="number" value={r.numDms} onChange={(e) => setEditRoleSplits((prev) => prev.map((x, j) => j === i ? { ...x, numDms: Number(e.target.value) } : x))} /></td>
                      <td className="p-1"><input className={icNum} type="number" value={r.saPoolPct} onChange={(e) => setEditRoleSplits((prev) => prev.map((x, j) => j === i ? { ...x, saPoolPct: Number(e.target.value) } : x))} /></td>
                      <td className="p-1"><input className={icNum} type="number" value={r.smSharePct} onChange={(e) => setEditRoleSplits((prev) => prev.map((x, j) => j === i ? { ...x, smSharePct: Number(e.target.value) } : x))} /></td>
                      <td className="p-1"><input className={icNum} type="number" value={r.dmSharePerDmPct} onChange={(e) => setEditRoleSplits((prev) => prev.map((x, j) => j === i ? { ...x, dmSharePerDmPct: Number(e.target.value) } : x))} /></td>
                    </>) : (<>
                      <td className="p-2 text-center">{r.numSms}</td><td className="p-2 text-center">{r.numDms}</td>
                      <td className="p-2 text-right">{Number(r.saPoolPct)}%</td><td className="p-2 text-right">{Number(r.smSharePct)}%</td>
                      <td className="p-2 text-right">{Number(r.dmSharePerDmPct) > 0 ? `${Number(r.dmSharePerDmPct)}%` : "—"}</td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
