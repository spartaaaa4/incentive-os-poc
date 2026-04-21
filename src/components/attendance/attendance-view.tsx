"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { Upload, Download, AlertCircle, CheckCircle2, FileSpreadsheet, Clock, X } from "lucide-react";

type AttnRow = {
  employeeId: string;
  storeCode: string;
  date: string;
  status: string;
};

type StatusPayload = {
  isConnected: boolean;
  currentMonthCovered: boolean;
  lastUploadWithinDays: boolean;
  latestUpload: {
    id: number;
    uploadedBy: string;
    fileName: string | null;
    rowCount: number;
    uploadedAt: string;
    periodStart: string | null;
    periodEnd: string | null;
    storeCount: number;
  } | null;
};

const VALID_STATUSES = ["PRESENT", "ABSENT", "LEAVE_APPROVED", "LEAVE_UNAPPROVED", "HOLIDAY"];
const expectedColumns = ["employeeId", "storeCode", "date", "status"];

function downloadTemplate() {
  const header = expectedColumns.join(",");
  const sample = ["E001", "3675", "15/04/2026", "PRESENT"].join(",");
  const blob = new Blob([`${header}\n${sample}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance_upload_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function AttendanceView() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [csvRows, setCsvRows] = useState<AttnRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; periodStart: string; periodEnd: string; stores: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const r = await fetch("/api/attendance/status");
      if (r.ok) setStatus(await r.json());
    } catch {}
    setLoadingStatus(false);
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const validateRow = (row: Record<string, string>, i: number): string[] => {
    const errs: string[] = [];
    expectedColumns.forEach((k) => { if (!row[k]?.trim()) errs.push(`Row ${i + 1}: "${k}" is required`); });
    if (row.status && !VALID_STATUSES.includes(row.status.trim().toUpperCase())) {
      errs.push(`Row ${i + 1}: status must be one of ${VALID_STATUSES.join(", ")} (got "${row.status}")`);
    }
    return errs;
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setUploadError(null);
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const headerMap = new Map<string, string>();
    expectedColumns.forEach((c) => headerMap.set(c.toLowerCase(), c));
    const normalized = parsed.data.map((row) => {
      const out: Record<string, string> = {};
      Object.entries(row).forEach(([k, v]) => {
        const clean = (v ?? "").toString().trim().replace(/^["']+|["']+$/g, "");
        const mapped = headerMap.get(k.trim().toLowerCase()) ?? k.trim();
        out[mapped] = clean;
      });
      return out;
    });

    const errs: string[] = [];
    const headers = Object.keys(normalized[0] ?? {});
    const missing = expectedColumns.filter((c) => !headers.includes(c));
    if (missing.length) errs.push(`Missing columns: ${missing.join(", ")}`);
    if (parsed.errors.length) errs.push(...parsed.errors.map((e) => e.message));
    if (!missing.length) {
      normalized.forEach((r, i) => errs.push(...validateRow(r, i)));
    }

    setCsvRows(normalized.map((r) => ({
      employeeId: r.employeeId,
      storeCode: r.storeCode,
      date: r.date,
      status: r.status.toUpperCase(),
    })));
    setCsvErrors(errs);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const doUpload = async () => {
    setImporting(true);
    setUploadError(null);
    try {
      const response = await fetch("/api/attendance/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: csvRows, fileName, uploadedBy: "admin" }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setUploadError((payload.errors ?? ["Upload failed"]).join("\n"));
      } else {
        setResult(payload);
        setCsvRows([]);
        setFileName("");
        setCsvErrors([]);
        void loadStatus();
      }
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setImporting(false);
  };

  const reset = () => {
    setCsvRows([]);
    setCsvErrors([]);
    setFileName("");
    setResult(null);
    setUploadError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const canUpload = csvRows.length > 0 && csvErrors.length === 0 && !importing;
  const banner = status && !status.isConnected;

  return (
    <div className="space-y-6">
      {!loadingStatus && banner ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertCircle className="text-amber-600 mt-0.5" size={18} />
          <div className="flex-1">
            <p className="font-medium text-amber-900">Attendance data not connected</p>
            <p className="text-sm text-amber-800 mt-1">
              {status.latestUpload
                ? `Last upload was on ${formatDateTime(status.latestUpload.uploadedAt)}. F&L weekly pool incentives will stay in "Pending" status until attendance for the current period is uploaded.`
                : "No attendance data has been uploaded. F&L weekly pool incentives cannot be calculated until attendance is connected."}
            </p>
          </div>
        </div>
      ) : null}

      {status?.latestUpload ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Clock size={14} /> Latest upload
          </div>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-slate-400 text-xs">Uploaded</div>
              <div className="text-slate-700">{formatDateTime(status.latestUpload.uploadedAt)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">By</div>
              <div className="text-slate-700">{status.latestUpload.uploadedBy}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Rows</div>
              <div className="text-slate-700">{status.latestUpload.rowCount.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Period</div>
              <div className="text-slate-700">
                {status.latestUpload.periodStart} → {status.latestUpload.periodEnd}
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Stores</div>
              <div className="text-slate-700">{status.latestUpload.storeCount}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-800">Upload attendance CSV</h3>
            <p className="text-sm text-slate-500 mt-1">Columns: employeeId, storeCode, date (DD/MM/YYYY), status</p>
          </div>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Download size={14} /> Template
          </button>
        </div>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
            dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={onInputChange}
            className="hidden"
          />
          {fileName ? (
            <>
              <FileSpreadsheet className="text-slate-500" size={32} />
              <p className="font-medium text-slate-700">{fileName}</p>
              <p className="text-xs text-slate-500">{csvRows.length} rows parsed</p>
            </>
          ) : (
            <>
              <Upload className="text-slate-400" size={32} />
              <p className="text-slate-600">Drop CSV here or click to browse</p>
            </>
          )}
        </label>

        {csvErrors.length > 0 ? (
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3">
            <div className="flex items-center gap-2 text-red-800 font-medium text-sm mb-2">
              <AlertCircle size={14} /> {csvErrors.length} validation error(s)
            </div>
            <ul className="text-xs text-red-700 space-y-1 max-h-40 overflow-auto">
              {csvErrors.slice(0, 20).map((e, i) => <li key={i}>• {e}</li>)}
              {csvErrors.length > 20 ? <li>... and {csvErrors.length - 20} more</li> : null}
            </ul>
          </div>
        ) : null}

        {uploadError ? (
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800 whitespace-pre-wrap">
            <div className="flex items-center gap-2 font-medium mb-1"><AlertCircle size={14} /> Upload failed</div>
            {uploadError}
          </div>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 p-3">
            <div className="flex items-center gap-2 text-emerald-800 font-medium text-sm">
              <CheckCircle2 size={14} /> Imported {result.imported} attendance rows
            </div>
            <p className="text-xs text-emerald-700 mt-1">
              Period {result.periodStart} → {result.periodEnd} across {result.stores} store(s). F&L weekly pool is being recalculated.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-3">
          {fileName ? (
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <X size={14} /> Clear
            </button>
          ) : null}
          <button
            onClick={doUpload}
            disabled={!canUpload}
            className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload size={14} /> {importing ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
