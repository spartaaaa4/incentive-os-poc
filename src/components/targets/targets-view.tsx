"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Download, Upload, X, FileSpreadsheet, AlertCircle, CheckCircle2, Search, RotateCcw } from "lucide-react";
import { formatInr } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

const selectClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors";
const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors w-[130px]";

type TargetRow = {
  id: number;
  storeCode: string;
  storeName: string;
  state: string;
  vertical: string;
  department: string | null;
  productFamilyCode: string | null;
  productFamilyName: string | null;
  targetValue: number;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
};

const tabs = ["Electronics", "Grocery", "F&L"] as const;
type Tab = (typeof tabs)[number];
const tabToVertical: Record<Tab, string> = { Electronics: "ELECTRONICS", Grocery: "GROCERY", "F&L": "FNL" };

const expectedColumns: Record<Tab, string[]> = {
  Electronics: ["storeCode", "vertical", "department", "productFamilyCode", "productFamilyName", "targetValue", "periodType", "periodStart", "periodEnd"],
  Grocery: ["storeCode", "vertical", "targetValue", "periodType", "periodStart", "periodEnd"],
  "F&L": ["storeCode", "vertical", "targetValue", "periodType", "periodStart", "periodEnd"],
};

type TargetFilters = {
  search: string;
  storeCode: string;
  state: string;
  department: string;
  productFamilyName: string;
  targetValueMin: string;
  targetValueMax: string;
  periodFrom: string;
  periodTo: string;
};

const emptyTargetFilters: TargetFilters = {
  search: "", storeCode: "", state: "", department: "", productFamilyName: "",
  targetValueMin: "", targetValueMax: "", periodFrom: "", periodTo: "",
};

export function TargetsView() {
  const [active, setActive] = useState<Tab>("Electronics");
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<TargetFilters>(emptyTargetFilters);
  const [appliedFilters, setAppliedFilters] = useState<TargetFilters>(emptyTargetFilters);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/targets?vertical=${tabToVertical[active]}`)
      .then((r) => (r.ok ? r.json() : { targets: [] }))
      .then((d) => setRows(d.targets ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [active]);

  useEffect(() => { load(); }, [load]);

  // Reset filters when tab changes
  useEffect(() => {
    setFilters(emptyTargetFilters);
    setAppliedFilters(emptyTargetFilters);
  }, [active]);

  // Derive unique filter options from all loaded rows
  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((r) => { if (!seen.has(r.storeCode)) seen.set(r.storeCode, r.storeName); });
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const stateOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.state).filter(Boolean))].sort();
  }, [rows]);

  const departmentOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])].sort();
  }, [rows]);

  const familyNameOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.productFamilyName).filter(Boolean) as string[])].sort();
  }, [rows]);

  // Client-side filtered rows
  const filteredRows = useMemo(() => {
    const f = appliedFilters;
    const minVal = f.targetValueMin ? parseFloat(f.targetValueMin) : null;
    const maxVal = f.targetValueMax ? parseFloat(f.targetValueMax) : null;
    return rows.filter((r) => {
      if (f.storeCode && r.storeCode !== f.storeCode) return false;
      if (f.state && r.state !== f.state) return false;
      if (f.department && r.department !== f.department) return false;
      if (f.productFamilyName && r.productFamilyName !== f.productFamilyName) return false;
      if (minVal !== null && r.targetValue < minVal) return false;
      if (maxVal !== null && r.targetValue > maxVal) return false;
      if (f.periodFrom && r.periodEnd < f.periodFrom) return false;
      if (f.periodTo && r.periodStart > f.periodTo) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        const match =
          r.storeCode.toLowerCase().includes(q) ||
          r.storeName.toLowerCase().includes(q) ||
          r.state.toLowerCase().includes(q) ||
          (r.department ?? "").toLowerCase().includes(q) ||
          (r.productFamilyName ?? "").toLowerCase().includes(q) ||
          (r.productFamilyCode ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [rows, appliedFilters]);

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  const handleApply = () => setAppliedFilters({ ...filters });
  const handleReset = () => { setFilters(emptyTargetFilters); setAppliedFilters(emptyTargetFilters); };
  const updateFilter = (key: keyof TargetFilters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const normalized = parsed.data.map((row) => {
      const out: Record<string, string> = {};
      Object.entries(row).forEach(([k, v]) => { out[k.trim()] = v?.toString().trim() ?? ""; });
      return out;
    });
    const missing = expectedColumns[active].filter((c) => !Object.keys(normalized[0] ?? {}).includes(c));
    setCsvRows(normalized);
    setCsvErrors(missing.length ? [`Missing columns: ${missing.join(", ")}`] : []);
  };

  const downloadTemplate = () => {
    const cols = expectedColumns[active];
    const sampleByTab: Record<Tab, string[]> = {
      Electronics: ["3675", "ELECTRONICS", "IT", "FF01", "Laptop", "888104", "MONTHLY", "2026-04-01", "2026-04-30"],
      Grocery: ["2536", "GROCERY", "67000", "CAMPAIGN", "2026-04-15", "2026-04-25"],
      "F&L": ["FL01", "FNL", "1200000", "WEEKLY", "2026-04-05", "2026-04-11"],
    };
    const csv = cols.join(",") + "\n" + sampleByTab[active].join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.toLowerCase()}_targets_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetModal = () => {
    setShowUpload(false);
    setCsvRows([]);
    setCsvErrors([]);
    setFileName("");
  };

  const importCsv = async () => {
    setImporting(true);
    const res = await fetch("/api/targets/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: csvRows }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setCsvErrors(payload.errors ?? ["Import failed"]);
      setImporting(false);
      return;
    }
    setShowUpload(false);
    setCsvRows([]);
    setCsvErrors([]);
    setImporting(false);
    load();
  };

  const previewRows = useMemo(() => csvRows.slice(0, 5), [csvRows]);

  return (
    <div className="space-y-4">
      {/* Tab bar + upload */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button key={t} onClick={() => setActive(t)}
              className={`px-4 py-2 text-sm rounded-lg border ${active === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"}`}>
              {t}
            </button>
          ))}
        </div>
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
          <Upload size={14} /> Upload Targets CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Store</label>
            <select value={filters.storeCode} onChange={(e) => updateFilter("storeCode", e.target.value)} className={selectClass}>
              <option value="">All Stores</option>
              {storeOptions.map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">State</label>
            <select value={filters.state} onChange={(e) => updateFilter("state", e.target.value)} className={selectClass}>
              <option value="">All States</option>
              {stateOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {active === "Electronics" && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Department</label>
              <select value={filters.department} onChange={(e) => updateFilter("department", e.target.value)} className={selectClass}>
                <option value="">All Departments</option>
                {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          {active === "Electronics" && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Family Name</label>
              <select value={filters.productFamilyName} onChange={(e) => updateFilter("productFamilyName", e.target.value)} className={selectClass}>
                <option value="">All Families</option>
                {familyNameOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Target Min (₹)</label>
            <input type="number" placeholder="0" value={filters.targetValueMin} onChange={(e) => updateFilter("targetValueMin", e.target.value)} className={inputClass} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Target Max (₹)</label>
            <input type="number" placeholder="∞" value={filters.targetValueMax} onChange={(e) => updateFilter("targetValueMax", e.target.value)} className={inputClass} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Period From</label>
            <input type="date" value={filters.periodFrom} onChange={(e) => updateFilter("periodFrom", e.target.value)} className={inputClass} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Period To</label>
            <input type="date" value={filters.periodTo} onChange={(e) => updateFilter("periodTo", e.target.value)} className={inputClass} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Search</label>
            <input
              type="text"
              placeholder="Store / State / Dept / Family"
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors w-[200px]"
            />
          </div>

          <button onClick={handleApply}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Search size={14} /> Apply
          </button>

          {hasActiveFilters && (
            <button onClick={handleReset}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              <RotateCcw size={14} /> Reset
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <span className="font-medium text-slate-700">
            {filteredRows.length === 0 ? "No results" : `${filteredRows.length.toLocaleString()} record${filteredRows.length !== 1 ? "s" : ""}`}
            {hasActiveFilters && rows.length !== filteredRows.length && ` (filtered from ${rows.length.toLocaleString()})`}
          </span>
          {hasActiveFilters && (
            <>
              {appliedFilters.storeCode && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.storeCode}</span>}
              {appliedFilters.state && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.state}</span>}
              {appliedFilters.department && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.department}</span>}
              {appliedFilters.productFamilyName && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.productFamilyName}</span>}
              {appliedFilters.targetValueMin && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">Min ₹{appliedFilters.targetValueMin}</span>}
              {appliedFilters.targetValueMax && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">Max ₹{appliedFilters.targetValueMax}</span>}
              {appliedFilters.periodFrom && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">From {formatDate(appliedFilters.periodFrom)}</span>}
              {appliedFilters.periodTo && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">To {formatDate(appliedFilters.periodTo)}</span>}
              {appliedFilters.search && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">&quot;{appliedFilters.search}&quot;</span>}
            </>
          )}
        </div>
      </div>

      {/* Data table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Store</th>
              <th className="p-3 text-left">State</th>
              {active === "Electronics" && <th className="p-3 text-left">Department</th>}
              {active === "Electronics" && <th className="p-3 text-left">Family Code</th>}
              {active === "Electronics" && <th className="p-3 text-left">Family Name</th>}
              <th className="p-3 text-left">Target Value</th>
              <th className="p-3 text-left">Period</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="p-3">{r.storeCode} — {r.storeName}</td>
                <td className="p-3">{r.state}</td>
                {active === "Electronics" && <td className="p-3">{r.department ?? "—"}</td>}
                {active === "Electronics" && <td className="p-3">{r.productFamilyCode ?? "—"}</td>}
                {active === "Electronics" && <td className="p-3">{r.productFamilyName ?? "—"}</td>}
                <td className="p-3">{formatInr(r.targetValue)}</td>
                <td className="p-3 text-xs whitespace-nowrap">{formatDate(r.periodStart)} to {formatDate(r.periodEnd)}</td>
                <td className="p-3"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {loading && <tr><td className="p-3 text-slate-500" colSpan={8}>Loading targets...</td></tr>}
            {!loading && filteredRows.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={8}>No targets found.</td></tr>}
          </tbody>
        </table>
      </div>

      {showUpload && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Upload {active} Targets</h3>
                <p className="text-xs text-slate-500 mt-0.5">All uploaded targets enter SUBMITTED status for maker-checker approval</p>
              </div>
              <button onClick={resetModal} className="rounded-lg p-1.5 hover:bg-slate-100 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-slate-900">Prepare your file</h4>
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    <Download size={12} /> Download Template
                  </button>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-medium text-slate-700 mb-1">Required columns:</p>
                  <p className="font-mono">{expectedColumns[active].join(", ")}</p>
                </div>
              </div>

              <div
                className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                  dragging ? "border-blue-400 bg-blue-50" : fileName ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-white hover:border-slate-400"
                } p-8 text-center`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                {fileName ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet size={32} className="text-emerald-600" />
                    <p className="text-sm font-medium text-slate-900">{fileName}</p>
                    <p className="text-xs text-slate-500">{csvRows.length} rows parsed</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={32} className="text-slate-400" />
                    <p className="text-sm text-slate-600"><span className="font-medium text-blue-600">Click to browse</span> or drag and drop</p>
                    <p className="text-xs text-slate-400">CSV files only</p>
                  </div>
                )}
              </div>

              {csvRows.length > 0 && (
                <div>
                  <div className="flex gap-3 mb-3">
                    <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm">
                      <FileSpreadsheet size={14} className="text-slate-500" />
                      <span className="text-slate-600">{csvRows.length} rows</span>
                    </div>
                    {csvErrors.length === 0 ? (
                      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        <span className="text-emerald-700">Ready to import</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm">
                        <AlertCircle size={14} className="text-red-600" />
                        <span className="text-red-700">{csvErrors.length} error(s)</span>
                      </div>
                    )}
                  </div>
                  {csvErrors.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-3">
                      {csvErrors.map((e) => <p key={e} className="flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" /> {e}</p>)}
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2 py-2 text-left text-[10px] font-medium">#</th>
                          {expectedColumns[active].map((c) => (
                            <th key={c} className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                            {expectedColumns[active].map((c) => (
                              <td key={c} className="px-2 py-1.5 text-slate-700">{row[c] ?? ""}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {csvRows.length > 5 && (
                      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 text-center">
                        Showing 5 of {csvRows.length} rows
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50/50">
              <button onClick={resetModal}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void importCsv()} disabled={importing || csvRows.length === 0 || csvErrors.length > 0}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {importing ? "Importing..." : `Import ${csvRows.length > 0 ? csvRows.length + " rows" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
