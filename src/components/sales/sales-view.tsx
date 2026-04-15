"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Download, Upload, X, FileSpreadsheet, AlertCircle, CheckCircle2, Search, RotateCcw } from "lucide-react";
import { formatInr } from "@/lib/format";

type SalesRow = {
  transactionId: string;
  transactionDate: string;
  storeCode: string;
  storeName: string;
  vertical: string;
  employeeName: string;
  department: string;
  articleCode: string;
  brand: string;
  quantity: number;
  grossAmount: number;
  taxAmount: number;
  totalAmount: number;
  transactionType: string;
  channel: string;
  calculatedIncentive: string;
  incentiveAmount: number;
  status: "Calculated" | "Pending" | "Excluded";
};

type StoreOption = { storeCode: string; storeName: string; vertical: string };
type EmployeeOption = { employeeId: string; employeeName: string; storeCode: string };

type Filters = {
  vertical: string;
  storeCode: string;
  transactionType: string;
  employeeId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

const emptyFilters: Filters = { vertical: "", storeCode: "", transactionType: "", employeeId: "", dateFrom: "", dateTo: "", search: "" };

const columnSpec = [
  { key: "transactionId", label: "Transaction ID", type: "String", required: true, description: "Unique identifier for the sales transaction" },
  { key: "transactionDate", label: "Transaction Date", type: "Date (DD/MM/YYYY)", required: true, description: "Date on which the sale was recorded" },
  { key: "storeCode", label: "Store Code", type: "String", required: true, description: "Unique code identifying the store" },
  { key: "vertical", label: "Vertical", type: "String", required: true, description: "ELECTRONICS, GROCERY, or FNL" },
  { key: "storeFormat", label: "Store Format", type: "String", required: true, description: "e.g. Reliance Digital, Signature, Smart, Trends, TST" },
  { key: "employeeId", label: "Employee ID", type: "String", required: false, description: "ID of employee who made the sale. For BA sales in Electronics, use SM's ID. Leave blank if not applicable" },
  { key: "department", label: "Department", type: "String", required: false, description: "e.g. IT, ENT, Telecom. Required for Electronics" },
  { key: "articleCode", label: "Article Code", type: "String", required: true, description: "Unique product/article identifier (SKU)" },
  { key: "productFamilyCode", label: "Product Family Code", type: "String", required: false, description: "e.g. FF01, FH01. Required for Electronics" },
  { key: "brand", label: "Brand", type: "String", required: false, description: "Brand name. Required for Electronics where incentive varies by brand" },
  { key: "quantity", label: "Quantity", type: "Integer", required: true, description: "Number of units sold" },
  { key: "grossAmount", label: "Gross Amount", type: "Decimal", required: true, description: "Total sale value before tax (Qty x Unit Price). Used for all incentive calculations" },
  { key: "taxAmount", label: "Tax Amount", type: "Decimal", required: true, description: "Tax applicable on the transaction" },
  { key: "totalAmount", label: "Total Amount", type: "Decimal", required: true, description: "Gross Amount + Tax Amount" },
  { key: "transactionType", label: "Transaction Type", type: "String", required: true, description: "NORMAL, SFS (Ship From Store), PAS (Pick at Store), or JIOMART" },
  { key: "channel", label: "Channel", type: "String", required: true, description: "OFFLINE or ONLINE" },
];

const expectedColumns = columnSpec.map((c) => c.key);

function statusClass(status: SalesRow["status"]) {
  if (status === "Calculated") return "bg-emerald-50 text-emerald-700";
  if (status === "Excluded") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function downloadTemplate() {
  const header = expectedColumns.join(",");
  const sampleRow = [
    "TXN001", "15/04/2026", "3675", "ELECTRONICS", "Reliance Digital",
    "E001", "Telecom", "PH123456", "FK01", "Samsung",
    "1", "19000", "3420", "22420", "NORMAL", "OFFLINE",
  ].join(",");
  const csv = `${header}\n${sampleRow}\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sales_upload_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const selectClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors";
const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors w-[150px]";

export function SalesView() {
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Map<number, string[]>>(new Map());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showFieldRef, setShowFieldRef] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const VALID_VERTICALS = ["ELECTRONICS", "GROCERY", "FNL"];
  const VALID_TX_TYPES = ["NORMAL", "SFS", "PAS", "JIOMART"];
  const VALID_CHANNELS = ["OFFLINE", "ONLINE"];

  function validateRow(row: Record<string, string>, index: number): string[] {
    const errs: string[] = [];
    const req = ["transactionId", "transactionDate", "storeCode", "vertical", "storeFormat", "articleCode", "quantity", "grossAmount", "taxAmount", "totalAmount", "transactionType", "channel"];
    req.forEach((f) => { if (!row[f]?.trim()) errs.push(`Row ${index + 1}: "${f}" is required`); });
    if (row.vertical && !VALID_VERTICALS.includes(row.vertical.trim().toUpperCase())) errs.push(`Row ${index + 1}: vertical must be ELECTRONICS, GROCERY, or FNL (got "${row.vertical}")`);
    if (row.transactionType && !VALID_TX_TYPES.includes(row.transactionType.trim().toUpperCase())) errs.push(`Row ${index + 1}: transactionType must be NORMAL, SFS, PAS, or JIOMART (got "${row.transactionType}")`);
    if (row.channel && !VALID_CHANNELS.includes(row.channel.trim().toUpperCase())) errs.push(`Row ${index + 1}: channel must be OFFLINE or ONLINE (got "${row.channel}")`);
    if (row.quantity && (isNaN(Number(row.quantity)) || Number(row.quantity) <= 0 || !Number.isInteger(Number(row.quantity)))) errs.push(`Row ${index + 1}: quantity must be a positive integer (got "${row.quantity}")`);
    ["grossAmount", "taxAmount", "totalAmount"].forEach((f) => {
      if (row[f] && (isNaN(Number(row[f])) || Number(row[f]) < 0)) errs.push(`Row ${index + 1}: ${f} must be a non-negative number (got "${row[f]}")`);
    });
    return errs;
  }

  useEffect(() => {
    fetch("/api/sales/filters")
      .then((r) => (r.ok ? r.json() : { stores: [], employees: [] }))
      .then((d) => {
        setStores(d.stores ?? []);
        setEmployees(d.employees ?? []);
      })
      .catch(() => {});
  }, []);

  const loadRows = useCallback(async (f: Filters, pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.vertical) params.set("vertical", f.vertical);
      if (f.storeCode) params.set("storeCode", f.storeCode);
      if (f.transactionType) params.set("transactionType", f.transactionType);
      if (f.employeeId) params.set("employeeId", f.employeeId);
      if (f.dateFrom) params.set("dateFrom", f.dateFrom);
      if (f.dateTo) params.set("dateTo", f.dateTo);
      if (f.search) params.set("search", f.search);
      params.set("page", String(pg));
      params.set("pageSize", String(pageSize));
      const response = await fetch(`/api/sales?${params.toString()}`);
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setRows(payload.rows ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setRows([]);
      setTotal(0);
    }
    setLoading(false);
  }, [pageSize]);

  useEffect(() => { void loadRows(appliedFilters, page); }, [loadRows, appliedFilters, page]);

  const filteredStores = useMemo(() => {
    if (!filters.vertical) return stores;
    return stores.filter((s) => s.vertical === filters.vertical);
  }, [stores, filters.vertical]);

  const filteredEmployees = useMemo(() => {
    if (!filters.storeCode) return employees;
    return employees.filter((e) => e.storeCode === filters.storeCode);
  }, [employees, filters.storeCode]);

  const handleApply = () => { setPage(1); setAppliedFilters({ ...filters }); };
  const handleReset = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPage(1);
  };

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  const previewRows = useMemo(() => csvRows.slice(0, 5), [csvRows]);
  const validCount = csvRows.length - rowErrors.size;

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

    // Build a case-insensitive header mapping: lowercase → expected camelCase key
    const headerMap = new Map<string, string>();
    expectedColumns.forEach((col) => headerMap.set(col.toLowerCase(), col));

    const normalizedRows = parsed.data.map((row) => {
      const normalized: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        const trimmed = key.trim();
        // Map to expected camelCase key (case-insensitive) or keep original
        const mapped = headerMap.get(trimmed.toLowerCase()) ?? trimmed;
        normalized[mapped] = value?.toString().trim().replace(/^["']+|["']+$/g, "") ?? "";
      });
      return normalized;
    });

    const errors: string[] = [];
    const headers = Object.keys(normalizedRows[0] ?? {});
    const missing = expectedColumns.filter((c) => !headers.includes(c));
    if (missing.length) errors.push(`Missing columns: ${missing.join(", ")}`);
    if (parsed.errors.length) errors.push(...parsed.errors.map((e) => e.message));

    const rowErrMap = new Map<number, string[]>();
    if (!missing.length) {
      normalizedRows.forEach((row, i) => {
        const errs = validateRow(row, i);
        if (errs.length) {
          rowErrMap.set(i, errs);
          errors.push(...errs);
        }
      });
    }

    setCsvRows(normalizedRows);
    setCsvErrors(errors);
    setRowErrors(rowErrMap);
    setImportResult(null);
  };

  const importCsv = async () => {
    setImporting(true);
    try {
      const response = await fetch("/api/sales/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: csvRows }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setCsvErrors(payload.errors ?? ["Import failed"]);
        setImporting(false);
        return;
      }
      setImportResult({ imported: payload.imported ?? 0, skipped: payload.skipped ?? 0 });
      setPage(1);
      await loadRows(appliedFilters, 1);
    } catch {
      setCsvErrors(["Network error during import — check your connection and try again"]);
    }
    setImporting(false);
  };

  const resetModal = () => {
    setShowUpload(false);
    setCsvRows([]);
    setCsvErrors([]);
    setRowErrors(new Map());
    setImportResult(null);
    setFileName("");
    setShowFieldRef(false);
  };

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "vertical") {
        next.storeCode = "";
        next.employeeId = "";
      }
      if (key === "storeCode") {
        next.employeeId = "";
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Vertical</label>
            <select value={filters.vertical} onChange={(e) => updateFilter("vertical", e.target.value)} className={selectClass}>
              <option value="">All Verticals</option>
              <option value="ELECTRONICS">Electronics</option>
              <option value="GROCERY">Grocery</option>
              <option value="FNL">F&L</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Store</label>
            <select value={filters.storeCode} onChange={(e) => updateFilter("storeCode", e.target.value)} className={selectClass}>
              <option value="">All Stores</option>
              {filteredStores.map((s) => (
                <option key={s.storeCode} value={s.storeCode}>{s.storeCode} — {s.storeName}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Transaction Type</label>
            <select value={filters.transactionType} onChange={(e) => updateFilter("transactionType", e.target.value)} className={selectClass}>
              <option value="">All Types</option>
              <option value="NORMAL">Normal</option>
              <option value="SFS">SFS</option>
              <option value="PAS">PAS</option>
              <option value="JIOMART">JioMart</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Employee</label>
            <select value={filters.employeeId} onChange={(e) => updateFilter("employeeId", e.target.value)} className={selectClass}>
              <option value="">All Employees</option>
              {filteredEmployees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>{e.employeeId} — {e.employeeName}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Date From</label>
            <input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className={inputClass} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Date To</label>
            <input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className={inputClass} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Search</label>
            <input
              type="text"
              placeholder="Txn ID / Employee / Article"
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

          <div className="ml-auto">
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
              <Upload size={14} /> Upload CSV
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <span className="font-medium text-slate-700">
            {total === 0 ? "No results" : `Showing ${((page - 1) * pageSize) + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()} records`}
          </span>
          {hasActiveFilters && (
            <>
            {appliedFilters.vertical && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.vertical}</span>}
            {appliedFilters.storeCode && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.storeCode}</span>}
            {appliedFilters.transactionType && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.transactionType}</span>}
            {appliedFilters.employeeId && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{appliedFilters.employeeId}</span>}
            {appliedFilters.dateFrom && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">From {appliedFilters.dateFrom}</span>}
            {appliedFilters.dateTo && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">To {appliedFilters.dateTo}</span>}
            {appliedFilters.search && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">"{appliedFilters.search}"</span>}
            </>
          )}
        </div>

      {/* Data table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Transaction ID</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Store</th>
              <th className="p-3 text-left">Vertical</th>
              <th className="p-3 text-left">Employee</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Article</th>
              <th className="p-3 text-left">Brand</th>
              <th className="p-3 text-right">Qty</th>
              <th className="p-3 text-right">Gross</th>
              <th className="p-3 text-right">Tax</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Channel</th>
              <th className="p-3 text-right">Incentive</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.transactionId} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="p-3 font-mono text-xs">{row.transactionId}</td>
                <td className="p-3 whitespace-nowrap">{row.transactionDate}</td>
                <td className="p-3 whitespace-nowrap">{row.storeCode} — {row.storeName}</td>
                <td className="p-3">{row.vertical}</td>
                <td className="p-3 whitespace-nowrap">{row.employeeName}</td>
                <td className="p-3">{row.department}</td>
                <td className="p-3 font-mono text-xs">{row.articleCode}</td>
                <td className="p-3">{row.brand}</td>
                <td className="p-3 text-right">{row.quantity}</td>
                <td className="p-3 text-right whitespace-nowrap">{formatInr(row.grossAmount)}</td>
                <td className="p-3 text-right whitespace-nowrap">{formatInr(row.taxAmount)}</td>
                <td className="p-3 text-right whitespace-nowrap">{formatInr(row.totalAmount)}</td>
                <td className="p-3">{row.transactionType}</td>
                <td className="p-3">{row.channel}</td>
                <td className="p-3 text-right whitespace-nowrap font-medium">
                  {row.incentiveAmount > 0 ? (
                    <span className="text-emerald-700">{row.calculatedIncentive}</span>
                  ) : (
                    <span className="text-slate-400">{row.calculatedIncentive}</span>
                  )}
                </td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(row.status)}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {loading && (
              <tr><td className="p-3 text-slate-500" colSpan={16}>Loading sales...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td className="p-3 text-slate-500" colSpan={16}>No sales transactions found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-slate-500">
            Page {page} of {Math.ceil(total / pageSize)}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              ← Previous
            </button>
            {Array.from({ length: Math.min(5, Math.ceil(total / pageSize)) }, (_, i) => {
              const totalPages = Math.ceil(total / pageSize);
              let start = Math.max(1, page - 2);
              if (start + 4 > totalPages) start = Math.max(1, totalPages - 4);
              return start + i;
            }).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${p === page ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(Math.ceil(total / pageSize), p + 1))}
              disabled={page >= Math.ceil(total / pageSize) || loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Upload Sales CSV</h3>
                <p className="text-xs text-slate-500 mt-0.5">Import sales transactions from a CSV file</p>
              </div>
              <button onClick={resetModal} className="rounded-lg p-1.5 hover:bg-slate-100 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-slate-900">Step 1: Prepare your file</h4>
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    <Download size={12} /> Download Template
                  </button>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <button onClick={() => setShowFieldRef(!showFieldRef)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 mb-2">
                    {showFieldRef ? "Hide" : "Show"} field reference ({columnSpec.length} columns)
                  </button>
                  {showFieldRef && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="pb-1.5 pr-3 font-medium">#</th>
                            <th className="pb-1.5 pr-3 font-medium">Field</th>
                            <th className="pb-1.5 pr-3 font-medium">Type</th>
                            <th className="pb-1.5 pr-3 font-medium">Req</th>
                            <th className="pb-1.5 font-medium">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {columnSpec.map((col, i) => (
                            <tr key={col.key} className="border-t border-slate-200/60">
                              <td className="py-1.5 pr-3 text-slate-400">{i + 1}</td>
                              <td className="py-1.5 pr-3 font-mono text-slate-800">{col.key}</td>
                              <td className="py-1.5 pr-3 text-slate-500">{col.type}</td>
                              <td className="py-1.5 pr-3">
                                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${col.required ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                                  {col.required ? "M" : "O"}
                                </span>
                              </td>
                              <td className="py-1.5 text-slate-600">{col.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-slate-900 mb-2">Step 2: Upload your CSV</h4>
                <div
                  className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                    dragging ? "border-blue-400 bg-blue-50" : fileName ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-white hover:border-slate-400"
                  } p-8 text-center`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file) void handleFile(file);
                  }}
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
                      <p className="text-sm text-slate-600">
                        <span className="font-medium text-blue-600">Click to browse</span> or drag and drop
                      </p>
                      <p className="text-xs text-slate-400">CSV files only</p>
                    </div>
                  )}
                </div>
              </div>

              {importResult && (
                <div className={`rounded-lg border p-4 ${importResult.skipped > 0 && importResult.imported === 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 size={16} className={importResult.imported > 0 ? "text-emerald-600 mt-0.5" : "text-amber-600 mt-0.5"} />
                    <div className="text-sm">
                      {importResult.imported > 0 && (
                        <p className="font-medium text-emerald-800">{importResult.imported} row{importResult.imported !== 1 ? "s" : ""} imported successfully</p>
                      )}
                      {importResult.skipped > 0 && (
                        <p className={`${importResult.imported > 0 ? "text-emerald-700 mt-0.5" : "font-medium text-amber-800"}`}>
                          {importResult.skipped} row{importResult.skipped !== 1 ? "s" : ""} skipped — transaction IDs already exist in the database
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {csvRows.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-900 mb-2">Step 3: Review and import</h4>
                  <div className="flex flex-wrap gap-3 mb-3">
                    <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm">
                      <FileSpreadsheet size={14} className="text-slate-500" />
                      <span className="text-slate-600">{csvRows.length} total rows</span>
                    </div>
                    {rowErrors.size === 0 ? (
                      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        <span className="text-emerald-700">{validCount} valid — ready to import</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm">
                          <AlertCircle size={14} className="text-red-600" />
                          <span className="text-red-700">{rowErrors.size} row{rowErrors.size !== 1 ? "s" : ""} with errors — fix before importing</span>
                        </div>
                        {validCount > 0 && (
                          <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm">
                            <span className="text-slate-600">{validCount} valid</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {csvErrors.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-3 space-y-1 max-h-40 overflow-y-auto">
                      {csvErrors.map((error, i) => (
                        <p key={i} className="flex items-start gap-1.5">
                          <AlertCircle size={12} className="mt-0.5 shrink-0 text-red-500" /> {error}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2 py-2 text-left text-[10px] font-medium">#</th>
                          {expectedColumns.map((col) => (
                            <th key={col} className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => {
                          const hasErr = rowErrors.has(i);
                          return (
                            <tr key={`${i}-${row.transactionId ?? "row"}`} className={`border-t ${hasErr ? "bg-red-50 border-red-100" : "border-slate-100"}`}>
                              <td className={`px-2 py-1.5 font-medium ${hasErr ? "text-red-500" : "text-slate-400"}`}>
                                {hasErr ? "!" : i + 1}
                              </td>
                              {expectedColumns.map((col) => {
                                const spec = columnSpec.find((s) => s.key === col);
                                const isEmpty = spec?.required && !row[col]?.trim();
                                return (
                                  <td key={`${i}-${col}`} className={`px-2 py-1.5 max-w-[120px] truncate ${isEmpty ? "bg-red-100 text-red-700 font-medium" : hasErr ? "text-red-800" : "text-slate-700"}`}>
                                    {row[col] ?? <span className="italic text-red-400">empty</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {csvRows.length > 5 && (
                      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 text-center">
                        Showing first 5 of {csvRows.length} rows preview
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50/50">
              <button onClick={resetModal}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                {importResult ? "Close" : "Cancel"}
              </button>
              {!importResult && (
                <button
                  onClick={() => void importCsv()}
                  disabled={importing || csvRows.length === 0 || csvErrors.length > 0}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {importing ? "Importing..." : `Import ${csvRows.length > 0 ? csvRows.length + " rows" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
