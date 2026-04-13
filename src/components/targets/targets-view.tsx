"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Download, Upload, X, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { formatInr } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";

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

export function TargetsView() {
  const [active, setActive] = useState<Tab>("Electronics");
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(false);
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

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Store</th>
              <th className="p-3 text-left">State</th>
              {active === "Electronics" && <th className="p-3 text-left">Department</th>}
              {active === "Electronics" && <th className="p-3 text-left">Family Code</th>}
              {active === "Electronics" && <th className="p-3 text-left">Family Name</th>}
              <th className="p-3 text-right">Target Value</th>
              <th className="p-3 text-left">Period</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3">{r.storeCode} — {r.storeName}</td>
                <td className="p-3">{r.state}</td>
                {active === "Electronics" && <td className="p-3">{r.department ?? "—"}</td>}
                {active === "Electronics" && <td className="p-3">{r.productFamilyCode ?? "—"}</td>}
                {active === "Electronics" && <td className="p-3">{r.productFamilyName ?? "—"}</td>}
                <td className="p-3 text-right">{formatInr(r.targetValue)}</td>
                <td className="p-3 text-xs">{r.periodStart} to {r.periodEnd}</td>
                <td className="p-3"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {loading && <tr><td className="p-3 text-slate-500" colSpan={8}>Loading targets...</td></tr>}
            {!loading && rows.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={8}>No targets found for this vertical.</td></tr>}
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
