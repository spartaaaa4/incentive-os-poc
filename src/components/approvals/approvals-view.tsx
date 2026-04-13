"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

type PendingItem = {
  id: string | number;
  entityType: "PLAN" | "TARGET";
  entityId: number;
  title: string;
  vertical: string;
  submittedBy: string;
  submittedAt: string;
  summary: string;
};

type HistoryItem = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  newValue: Record<string, unknown> | null;
  performedBy: string;
  performedAt: string;
};

export function ApprovalsView() {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejectId, setRejectId] = useState<{ entityType: string; entityId: number } | null>(null);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/approvals?tab=${tab}`)
      .then((r) => (r.ok ? r.json() : { items: [], history: [] }))
      .then((d) => {
        if (tab === "pending") setPending(d.items ?? []);
        else setHistory(d.history ?? []);
      })
      .catch(() => { setPending([]); setHistory([]); })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (entityType: string, entityId: number, action: "APPROVED" | "REJECTED", rejectReason?: string) => {
    setActing(true);
    await fetch("/api/approvals/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId, action, reason: rejectReason }),
    });
    setActing(false);
    setRejectId(null);
    setReason("");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm rounded-lg border ${tab === "pending" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"}`}>
          Pending
        </button>
        <button onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm rounded-lg border ${tab === "history" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"}`}>
          History
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading...</p>}

      {tab === "pending" && (
        <div className="space-y-4">
          {pending.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status="SUBMITTED" />
                    <span className="text-xs font-medium text-slate-500 uppercase">{item.entityType}</span>
                    <span className="text-xs text-slate-400">{item.vertical}</span>
                  </div>
                  <h3 className="font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-600 mt-1">{item.summary}</p>
                  <p className="text-xs text-slate-400 mt-2">
                    Submitted by {item.submittedBy} at {new Date(item.submittedAt).toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => void handleAction(item.entityType, item.entityId, "APPROVED")}
                    disabled={acting}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setRejectId({ entityType: item.entityType, entityId: item.entityId })}
                    disabled={acting}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!loading && pending.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm text-slate-500">No items pending approval.</p>
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3 text-left">Timestamp</th>
                <th className="p-3 text-left">Entity</th>
                <th className="p-3 text-left">Entity ID</th>
                <th className="p-3 text-left">Action</th>
                <th className="p-3 text-left">Performed By</th>
                <th className="p-3 text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="p-3 text-xs">{new Date(h.performedAt).toLocaleString("en-IN")}</td>
                  <td className="p-3">{h.entityType}</td>
                  <td className="p-3">{h.entityId}</td>
                  <td className="p-3"><StatusBadge status={h.action} /></td>
                  <td className="p-3">{h.performedBy}</td>
                  <td className="p-3 text-xs text-slate-500">
                    {h.newValue ? JSON.stringify(h.newValue).slice(0, 80) : "—"}
                  </td>
                </tr>
              ))}
              {!loading && history.length === 0 && (
                <tr><td colSpan={6} className="p-3 text-slate-500">No audit history yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {rejectId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 space-y-4">
            <h3 className="text-lg font-semibold">Rejection Reason</h3>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for rejection..."
              className="w-full rounded-md border border-slate-300 p-3 text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRejectId(null); setReason(""); }} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => void handleAction(rejectId.entityType, rejectId.entityId, "REJECTED", reason)}
                disabled={acting || !reason.trim()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
