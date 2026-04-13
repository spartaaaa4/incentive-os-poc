"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
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
  status: "Calculated" | "Pending" | "Excluded";
};

const expectedColumns = [
  "transactionId",
  "transactionDate",
  "storeCode",
  "vertical",
  "storeFormat",
  "employeeId",
  "department",
  "articleCode",
  "productFamilyCode",
  "brand",
  "quantity",
  "grossAmount",
  "taxAmount",
  "totalAmount",
  "transactionType",
  "channel",
];

function statusClass(status: SalesRow["status"]) {
  if (status === "Calculated") return "bg-emerald-50 text-emerald-700";
  if (status === "Excluded") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

export function SalesView() {
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    const response = await fetch("/api/sales");
    const payload = await response.json();
    setRows(payload.rows ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const previewRows = useMemo(() => csvRows.slice(0, 5), [csvRows]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const normalizedRows = parsed.data.map((row) => {
      const normalized: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[key.trim()] = value?.toString().trim() ?? "";
      });
      return normalized;
    });

    const headerErrors = expectedColumns.filter((column) => !Object.keys(normalizedRows[0] ?? {}).includes(column));
    const rowErrors: string[] = [];
    if (headerErrors.length) {
      rowErrors.push(`Missing columns: ${headerErrors.join(", ")}`);
    }
    if (parsed.errors.length) {
      rowErrors.push(...parsed.errors.map((error) => error.message));
    }

    setCsvRows(normalizedRows);
    setCsvErrors(rowErrors);
  };

  const importCsv = async () => {
    setImporting(true);
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
    setShowUpload(false);
    setCsvRows([]);
    setCsvErrors([]);
    setImporting(false);
    await loadRows();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowUpload(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Upload Sales CSV
        </button>
      </div>

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
              <th className="p-3 text-left">Calculated Incentive</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.transactionId} className="border-t border-slate-100">
                <td className="p-3">{row.transactionId}</td>
                <td className="p-3">{row.transactionDate}</td>
                <td className="p-3">
                  {row.storeCode} - {row.storeName}
                </td>
                <td className="p-3">{row.vertical}</td>
                <td className="p-3">{row.employeeName}</td>
                <td className="p-3">{row.department}</td>
                <td className="p-3">{row.articleCode}</td>
                <td className="p-3">{row.brand}</td>
                <td className="p-3 text-right">{row.quantity}</td>
                <td className="p-3 text-right">{formatInr(row.grossAmount)}</td>
                <td className="p-3 text-right">{formatInr(row.taxAmount)}</td>
                <td className="p-3 text-right">{formatInr(row.totalAmount)}</td>
                <td className="p-3">{row.transactionType}</td>
                <td className="p-3">{row.channel}</td>
                <td className="p-3">{row.calculatedIncentive}</td>
                <td className="p-3">
                  <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${statusClass(row.status)}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td className="p-3 text-slate-500" colSpan={16}>
                  Loading sales...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showUpload && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Upload Sales CSV</h3>
              <button className="text-slate-500" onClick={() => setShowUpload(false)}>
                Close
              </button>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <div className="text-sm text-slate-600">
              <p>Total rows: {csvRows.length}</p>
              <p>Valid rows: {Math.max(0, csvRows.length - csvErrors.length)}</p>
              <p>Errors: {csvErrors.length}</p>
            </div>
            {csvErrors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {csvErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}
            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {expectedColumns.map((column) => (
                      <th key={column} className="px-2 py-2 text-left">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${index}-${row.transactionId ?? "row"}`} className="border-t border-slate-100">
                      {expectedColumns.map((column) => (
                        <td key={`${index}-${column}`} className="px-2 py-1">
                          {row[column] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => void importCsv()}
                disabled={importing || csvRows.length === 0 || csvErrors.length > 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
