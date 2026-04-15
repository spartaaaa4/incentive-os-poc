"use client";

import { useState } from "react";
import {
  ChevronLeft, ChevronRight, Check, Package, ShoppingCart,
  Shirt, Loader2, X, Plus, Trash2,
} from "lucide-react";

type Step = "vertical" | "basics" | "config" | "review";
const STEPS: Step[] = ["vertical", "basics", "config", "review"];

type Vertical = "ELECTRONICS" | "GROCERY" | "FNL";

type SlabRow = { productFamily: string; brandFilter: string; priceFrom: number; priceTo: number; incentivePerUnit: number };
type MultiplierRow = { achievementFrom: number; achievementTo: number; multiplierPct: number };
type RoleSplitRow = { numSms: number; numDms: number; saPoolPct: number; smSharePct: number; dmSharePerDmPct: number };

const verticalOptions: Array<{ value: Vertical; label: string; description: string; icon: React.ReactNode }> = [
  { value: "ELECTRONICS", label: "Electronics", description: "Per-unit incentive on product sales with brand/price slabs and achievement multipliers", icon: <Package size={28} /> },
  { value: "GROCERY", label: "Grocery", description: "Campaign-based slab incentive with payout slabs and target distribution", icon: <ShoppingCart size={28} /> },
  { value: "FNL", label: "Fashion & Lifestyle", description: "Weekly store pool model with role-based splits and attendance eligibility", icon: <Shirt size={28} /> },
];

const defaultElectronicsSlabs: SlabRow[] = [
  { productFamily: "Photography", brandFilter: "All brands", priceFrom: 500, priceTo: 42000, incentivePerUnit: 40 },
  { productFamily: "Photography", brandFilter: "All brands", priceFrom: 42001, priceTo: 52000, incentivePerUnit: 75 },
  { productFamily: "Photography", brandFilter: "All brands", priceFrom: 52001, priceTo: 999999, incentivePerUnit: 120 },
  { productFamily: "Wireless Phones", brandFilter: "Samsung, Oppo, Vivo", priceFrom: 500, priceTo: 18000, incentivePerUnit: 25 },
  { productFamily: "Wireless Phones", brandFilter: "Samsung, Oppo, Vivo", priceFrom: 18001, priceTo: 20000, incentivePerUnit: 50 },
  { productFamily: "Wireless Phones", brandFilter: "Samsung, Oppo, Vivo", priceFrom: 20001, priceTo: 999999, incentivePerUnit: 75 },
  { productFamily: "Laptops & Desktops", brandFilter: "All brands excl Apple", priceFrom: 500, priceTo: 47000, incentivePerUnit: 50 },
  { productFamily: "Laptops & Desktops", brandFilter: "All brands excl Apple", priceFrom: 47001, priceTo: 52000, incentivePerUnit: 70 },
  { productFamily: "Laptops & Desktops", brandFilter: "All brands excl Apple", priceFrom: 52001, priceTo: 999999, incentivePerUnit: 90 },
];

const defaultMultipliers: MultiplierRow[] = [
  { achievementFrom: 0, achievementTo: 84.99, multiplierPct: 0 },
  { achievementFrom: 85, achievementTo: 89.99, multiplierPct: 50 },
  { achievementFrom: 90, achievementTo: 99.99, multiplierPct: 80 },
  { achievementFrom: 100, achievementTo: 109.99, multiplierPct: 100 },
  { achievementFrom: 110, achievementTo: 119.99, multiplierPct: 110 },
  { achievementFrom: 120, achievementTo: 999, multiplierPct: 120 },
];

const defaultRoleSplits: RoleSplitRow[] = [
  { numSms: 1, numDms: 0, saPoolPct: 70, smSharePct: 30, dmSharePerDmPct: 0 },
  { numSms: 1, numDms: 1, saPoolPct: 60, smSharePct: 24, dmSharePerDmPct: 16 },
  { numSms: 1, numDms: 2, saPoolPct: 60, smSharePct: 16, dmSharePerDmPct: 12 },
];

export function PlanWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<Step>("vertical");
  const [vertical, setVertical] = useState<Vertical | null>(null);
  const [planName, setPlanName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("2026-04-01");
  const [effectiveTo, setEffectiveTo] = useState("2026-06-30");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Electronics config
  const [slabs, setSlabs] = useState<SlabRow[]>(defaultElectronicsSlabs);
  const [multipliers, setMultipliers] = useState<MultiplierRow[]>(defaultMultipliers);

  // F&L config
  const [poolPct, setPoolPct] = useState(1);
  const [attendanceMinDays, setAttendanceMinDays] = useState(5);
  const [roleSplits, setRoleSplits] = useState<RoleSplitRow[]>(defaultRoleSplits);

  // Grocery config
  const [campaignName, setCampaignName] = useState("April Campaign");
  const [campaignStart, setCampaignStart] = useState("2026-04-01");
  const [campaignEnd, setCampaignEnd] = useState("2026-04-30");
  const [distributionRule, setDistributionRule] = useState<"EQUAL">("EQUAL");

  const stepIdx = STEPS.indexOf(step);
  const canNext = () => {
    if (step === "vertical") return !!vertical;
    if (step === "basics") return planName.trim().length > 0;
    return true;
  };

  const goNext = () => {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]);
  };
  const goBack = () => {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1]);
  };

  const handleVerticalSelect = (v: Vertical) => {
    setVertical(v);
    if (v === "ELECTRONICS") setPlanName("Electronics Per Unit Plan");
    else if (v === "GROCERY") setPlanName("Grocery Campaign Plan");
    else setPlanName("F&L Weekly Store Pool");
  };

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/rules/create/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical,
          planName,
          effectiveFrom,
          effectiveTo,
          ...(vertical === "ELECTRONICS" ? { slabs, multipliers } : {}),
          ...(vertical === "FNL" ? { poolPct, attendanceMinDays, roleSplits } : {}),
          ...(vertical === "GROCERY" ? { campaignName, campaignStart, campaignEnd, distributionRule } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create plan");
      } else {
        onCreated();
      }
    } catch {
      setError("Network error");
    }
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Create Incentive Plan</h2>
            <p className="text-xs text-slate-400 mt-0.5">Step {stepIdx + 1} of {STEPS.length}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-400"><X size={18} /></button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-4">
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIdx ? "bg-blue-500" : "bg-slate-200"}`} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6">
          {step === "vertical" && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-slate-700">Select Vertical</h3>
              <div className="grid grid-cols-3 gap-4">
                {verticalOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleVerticalSelect(opt.value)}
                    className={`flex flex-col items-center gap-3 rounded-xl border-2 p-5 text-center transition-all ${
                      vertical === opt.value
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className={vertical === opt.value ? "text-blue-600" : "text-slate-400"}>{opt.icon}</span>
                    <span className="font-semibold text-slate-700">{opt.label}</span>
                    <span className="text-xs text-slate-500 leading-relaxed">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "basics" && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-slate-700">Plan Details</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Plan Name</label>
                  <input value={planName} onChange={(e) => setPlanName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Effective From</label>
                    <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Effective To</label>
                    <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                Plans are created in DRAFT status. Submit for approval to make them active and usable in calculations.
              </div>
            </div>
          )}

          {step === "config" && vertical === "ELECTRONICS" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-slate-700 mb-3">Product Incentive Slabs</h3>
                <div className="overflow-auto max-h-60 border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-slate-500">Product Family</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-500">Brand Filter</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Price From</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Price To</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Incentive/Unit</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {slabs.map((s, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5"><input value={s.productFamily} onChange={(e) => { const n = [...slabs]; n[i] = { ...s, productFamily: e.target.value }; setSlabs(n); }} className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5"><input value={s.brandFilter} onChange={(e) => { const n = [...slabs]; n[i] = { ...s, brandFilter: e.target.value }; setSlabs(n); }} className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={s.priceFrom} onChange={(e) => { const n = [...slabs]; n[i] = { ...s, priceFrom: +e.target.value }; setSlabs(n); }} className="w-20 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={s.priceTo} onChange={(e) => { const n = [...slabs]; n[i] = { ...s, priceTo: +e.target.value }; setSlabs(n); }} className="w-20 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={s.incentivePerUnit} onChange={(e) => { const n = [...slabs]; n[i] = { ...s, incentivePerUnit: +e.target.value }; setSlabs(n); }} className="w-16 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-1"><button onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 p-0.5"><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => setSlabs([...slabs, { productFamily: "", brandFilter: "All brands", priceFrom: 0, priceTo: 999999, incentivePerUnit: 0 }])}
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <Plus size={12} /> Add Slab
                </button>
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-700 mb-3">Achievement Multipliers</h3>
                <div className="overflow-auto max-h-48 border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Achievement From %</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Achievement To %</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Multiplier %</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {multipliers.map((m, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 text-right"><input type="number" value={m.achievementFrom} onChange={(e) => { const n = [...multipliers]; n[i] = { ...m, achievementFrom: +e.target.value }; setMultipliers(n); }} className="w-20 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={m.achievementTo} onChange={(e) => { const n = [...multipliers]; n[i] = { ...m, achievementTo: +e.target.value }; setMultipliers(n); }} className="w-20 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={m.multiplierPct} onChange={(e) => { const n = [...multipliers]; n[i] = { ...m, multiplierPct: +e.target.value }; setMultipliers(n); }} className="w-20 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-1"><button onClick={() => setMultipliers(multipliers.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 p-0.5"><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => setMultipliers([...multipliers, { achievementFrom: 0, achievementTo: 0, multiplierPct: 0 }])}
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <Plus size={12} /> Add Multiplier
                </button>
              </div>
            </div>
          )}

          {step === "config" && vertical === "FNL" && (
            <div className="space-y-6">
              <h3 className="text-base font-semibold text-slate-700">F&L Configuration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Pool Percentage (%)</label>
                  <input type="number" step="0.1" value={poolPct} onChange={(e) => setPoolPct(+e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-slate-400 mt-1">% of store sales above target allocated to incentive pool</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Min Attendance Days</label>
                  <input type="number" value={attendanceMinDays} onChange={(e) => setAttendanceMinDays(+e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-slate-400 mt-1">Minimum PRESENT days per week for eligibility</p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Role-Based Split Table</h4>
                <div className="overflow-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-center px-3 py-2 font-medium text-slate-500"># SMs</th>
                        <th className="text-center px-3 py-2 font-medium text-slate-500"># DMs</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">SA Pool %</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">SM Share %</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">DM Share/DM %</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {roleSplits.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 text-center"><input type="number" value={r.numSms} onChange={(e) => { const n = [...roleSplits]; n[i] = { ...r, numSms: +e.target.value }; setRoleSplits(n); }} className="w-12 text-center border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" /></td>
                          <td className="px-3 py-1.5 text-center"><input type="number" value={r.numDms} onChange={(e) => { const n = [...roleSplits]; n[i] = { ...r, numDms: +e.target.value }; setRoleSplits(n); }} className="w-12 text-center border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={r.saPoolPct} onChange={(e) => { const n = [...roleSplits]; n[i] = { ...r, saPoolPct: +e.target.value }; setRoleSplits(n); }} className="w-16 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={r.smSharePct} onChange={(e) => { const n = [...roleSplits]; n[i] = { ...r, smSharePct: +e.target.value }; setRoleSplits(n); }} className="w-16 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-3 py-1.5 text-right"><input type="number" value={r.dmSharePerDmPct} onChange={(e) => { const n = [...roleSplits]; n[i] = { ...r, dmSharePerDmPct: +e.target.value }; setRoleSplits(n); }} className="w-16 text-right border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1" /></td>
                          <td className="px-1"><button onClick={() => setRoleSplits(roleSplits.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 p-0.5"><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => setRoleSplits([...roleSplits, { numSms: 1, numDms: 0, saPoolPct: 70, smSharePct: 30, dmSharePerDmPct: 0 }])}
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <Plus size={12} /> Add Row
                </button>
              </div>
            </div>
          )}

          {step === "config" && vertical === "GROCERY" && (
            <div className="space-y-6">
              <h3 className="text-base font-semibold text-slate-700">Campaign Configuration</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Campaign Name</label>
                  <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Campaign Start</label>
                    <input type="date" value={campaignStart} onChange={(e) => setCampaignStart(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Campaign End</label>
                    <input type="date" value={campaignEnd} onChange={(e) => setCampaignEnd(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Distribution Rule</label>
                  <select
                    value={distributionRule}
                    onChange={(e) => setDistributionRule(e.target.value as "EQUAL")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="EQUAL">Equal (divide equally among eligible employees)</option>
                  </select>
                </div>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
                Campaign articles and store-level targets can be configured after creation from the plan detail page.
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-slate-700">Review & Create</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 p-3">
                  <span className="text-xs text-slate-400">Vertical</span>
                  <p className="font-semibold text-slate-700">{verticalOptions.find((v) => v.value === vertical)?.label}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <span className="text-xs text-slate-400">Plan Name</span>
                  <p className="font-semibold text-slate-700">{planName}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <span className="text-xs text-slate-400">Effective From</span>
                  <p className="font-semibold text-slate-700">{effectiveFrom}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <span className="text-xs text-slate-400">Effective To</span>
                  <p className="font-semibold text-slate-700">{effectiveTo}</p>
                </div>
                {vertical === "ELECTRONICS" && (
                  <>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <span className="text-xs text-slate-400">Product Slabs</span>
                      <p className="font-semibold text-slate-700">{slabs.length} slabs configured</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <span className="text-xs text-slate-400">Multiplier Tiers</span>
                      <p className="font-semibold text-slate-700">{multipliers.length} tiers</p>
                    </div>
                  </>
                )}
                {vertical === "FNL" && (
                  <>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <span className="text-xs text-slate-400">Pool %</span>
                      <p className="font-semibold text-slate-700">{poolPct}%</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <span className="text-xs text-slate-400">Role Split Rows</span>
                      <p className="font-semibold text-slate-700">{roleSplits.length} configurations</p>
                    </div>
                  </>
                )}
                {vertical === "GROCERY" && (
                  <>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <span className="text-xs text-slate-400">Campaign</span>
                      <p className="font-semibold text-slate-700">{campaignName}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <span className="text-xs text-slate-400">Distribution</span>
                      <p className="font-semibold text-slate-700">{distributionRule}</p>
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
                The plan will be created in <span className="font-semibold">DRAFT</span> status. You can edit, then submit for approval to activate.
              </div>
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700">{error}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-white px-6 py-4 rounded-b-2xl">
          <button onClick={stepIdx > 0 ? goBack : onClose}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700">
            <ChevronLeft size={16} /> {stepIdx > 0 ? "Back" : "Cancel"}
          </button>
          {step === "review" ? (
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {creating ? "Creating..." : "Create Plan"}
            </button>
          ) : (
            <button onClick={goNext} disabled={!canNext()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
