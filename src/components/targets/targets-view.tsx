"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
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
        <button onClick={() => setShowUpload(true)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Upload Targets CSV
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-3xl rounded-xl bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Upload {active} Targets CSV</h3>
              <button className="text-slate-500" onClick={() => setShowUpload(false)}>Close</button>
            </div>
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
            <div className="text-sm text-slate-600">
              <p>Expected columns: {expectedColumns[active].join(", ")}</p>
              <p>Total rows: {csvRows.length} | Errors: {csvErrors.length}</p>
            </div>
            {csvErrors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {csvErrors.map((e) => <p key={e}>{e}</p>)}
              </div>
            )}
            {previewRows.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>{expectedColumns[active].map((c) => <th key={c} className="px-2 py-2 text-left">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {expectedColumns[active].map((c) => <td key={c} className="px-2 py-1">{row[c] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => void importCsv()} disabled={importing || csvRows.length === 0 || csvErrors.length > 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
