"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInr, formatNumber } from "@/lib/format";
import { Eye, X, FileText, CheckCircle, XCircle, ExternalLink } from "lucide-react";

type PlanApprovalDetail = {
  planId: number;
  planName: string;
  vertical: string;
  formulaType: string;
  periodType: string;
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  submittedBy: string | null;
  createdBy: string | null;
  config: Record<string, unknown> | null;
  slabs: Array<{
    productFamily: string;
    brandFilter: string;
    priceFrom: number;
    priceTo: number;
    incentivePerUnit: number;
  }>;
  achievementMultipliers: Array<{
    achievementFrom: number;
    achievementTo: number;
    multiplierPct: number;
  }>;
  campaignConfigs: Array<{
    id: number;
    campaignName: string;
    startDate: string;
    endDate: string;
    channel: string;
    articlesCount: number;
    storeTargetsCount: number;
    payoutSlabsCount: number;
  }>;
  fnlRoleSplits: Array<{
    numSms: number;
    numDms: number;
    saPoolPct: number;
    smSharePct: number;
    dmSharePerDmPct: number;
  }>;
};

type TargetApprovalDetail = {
  rows: Array<{
    id: number;
    storeCode: string;
    storeName: string;
    department: string | null;
    productFamilyName: string | null;
    targetValue: number;
    periodType: string;
    periodStart: string;
    periodEnd: string;
    vertical: string;
  }>;
  vertical: string;
  periodType: string;
  rowCount: number;
};

type PendingPlanItem = {
  id: number;
  entityType: "PLAN";
  entityId: number;
  title: string;
  vertical: string;
  submittedBy: string;
  submittedAt: string;
  summary: string;
  planDetail: PlanApprovalDetail;
};

type PendingTargetItem = {
  id: string;
  entityType: "TARGET";
  entityId: number;
  title: string;
  vertical: string;
  submittedBy: string;
  submittedAt: string;
  summary: string;
  targetDetail: TargetApprovalDetail;
};

type PendingItem = PendingPlanItem | PendingTargetItem;

type HistoryItem = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  newValue: Record<string, unknown> | null;
  performedBy: string;
  performedAt: string;
};

const SLAB_PREVIEW_MAX = 35;

function PlanDetailBody({ d }: { d: PlanApprovalDetail }) {
  return (
    <div className="space-y-5 text-sm">
      <div className="grid grid-cols-2 gap-3 text-slate-700">
        <div><span className="text-slate-500">Vertical</span><br /><strong>{d.vertical}</strong></div>
        <div><span className="text-slate-500">Formula</span><br /><strong>{d.formulaType}</strong></div>
        <div><span className="text-slate-500">Period type</span><br /><strong>{d.periodType}</strong></div>
        <div><span className="text-slate-500">Version</span><br /><strong>{d.version}</strong></div>
        <div className="col-span-2">
          <span className="text-slate-500">Effective</span><br />
          <strong>{d.effectiveFrom ?? "—"}</strong> → <strong>{d.effectiveTo ?? "—"}</strong>
        </div>
        {d.config && Object.keys(d.config).length > 0 && (
          <div className="col-span-2 rounded-lg bg-slate-50 border border-slate-100 p-3 font-mono text-xs overflow-x-auto">
            <span className="text-slate-500 font-sans block mb-1">Plan config (JSON)</span>
            {JSON.stringify(d.config, null, 2)}
          </div>
        )}
      </div>

      {d.slabs.length > 0 && (
        <div>
          <h4 className="font-semibold text-slate-800 mb-2">Product incentive slabs ({d.slabs.length})</h4>
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-slate-500">
                  <th className="p-2">Family</th>
                  <th className="p-2">Brands</th>
                  <th className="p-2 text-right">Price from</th>
                  <th className="p-2 text-right">Price to</th>
                  <th className="p-2 text-right">₹ / unit</th>
                </tr>
              </thead>
              <tbody>
                {d.slabs.slice(0, SLAB_PREVIEW_MAX).map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 text-slate-800">{s.productFamily}</td>
                    <td className="p-2 text-slate-600">{s.brandFilter}</td>
                    <td className="p-2 text-right tabular-nums">{formatNumber(s.priceFrom)}</td>
                    <td className="p-2 text-right tabular-nums">{formatNumber(s.priceTo)}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{formatInr(s.incentivePerUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.slabs.length > SLAB_PREVIEW_MAX && (
            <p className="text-xs text-slate-500 mt-1">Showing first {SLAB_PREVIEW_MAX} of {d.slabs.length} slabs. Full list is editable on the Rules page after approval.</p>
          )}
        </div>
      )}

      {d.achievementMultipliers.length > 0 && (
        <div>
          <h4 className="font-semibold text-slate-800 mb-2">Achievement multipliers</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-500">
                  <th className="p-2">From %</th>
                  <th className="p-2">To %</th>
                  <th className="p-2 text-right">Multiplier %</th>
                </tr>
              </thead>
              <tbody>
                {d.achievementMultipliers.map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 tabular-nums">{m.achievementFrom}</td>
                    <td className="p-2 tabular-nums">{m.achievementTo}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{m.multiplierPct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.campaignConfigs.length > 0 && (
        <div>
          <h4 className="font-semibold text-slate-800 mb-2">Campaigns</h4>
          <ul className="space-y-2">
            {d.campaignConfigs.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <strong className="text-slate-900">{c.campaignName}</strong>
                <span className="text-slate-500"> · {c.startDate} → {c.endDate} · {c.channel}</span>
                <div className="text-slate-500 mt-1">
                  Articles: {c.articlesCount} · Store targets: {c.storeTargetsCount} · Payout slabs: {c.payoutSlabsCount}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.fnlRoleSplits.length > 0 && (
        <div>
          <h4 className="font-semibold text-slate-800 mb-2">F&L role splits</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-500">
                  <th className="p-2">#SM</th>
                  <th className="p-2">#DM</th>
                  <th className="p-2 text-right">SA pool %</th>
                  <th className="p-2 text-right">SM share %</th>
                  <th className="p-2 text-right">DM / DM %</th>
                </tr>
              </thead>
              <tbody>
                {d.fnlRoleSplits.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2">{r.numSms}</td>
                    <td className="p-2">{r.numDms}</td>
                    <td className="p-2 text-right tabular-nums">{r.saPoolPct}</td>
                    <td className="p-2 text-right tabular-nums">{r.smSharePct}</td>
                    <td className="p-2 text-right tabular-nums">{r.dmSharePerDmPct}</td>
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

function TargetDetailBody({ d }: { d: TargetApprovalDetail }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        <strong>{d.rowCount}</strong> row(s) · <strong>{d.vertical}</strong> · period type <strong>{d.periodType}</strong>
      </p>
      <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-slate-500">
              <th className="p-2">Store</th>
              <th className="p-2">Dept / family</th>
              <th className="p-2 text-right">Target</th>
              <th className="p-2">Period</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2">
                  <div className="font-medium text-slate-800">{r.storeName}</div>
                  <div className="text-slate-400 font-mono">{r.storeCode}</div>
                </td>
                <td className="p-2 text-slate-700">
                  {r.department ?? "—"}
                  {r.productFamilyName && <div className="text-slate-500">{r.productFamilyName}</div>}
                </td>
                <td className="p-2 text-right font-medium tabular-nums">{formatInr(r.targetValue)}</td>
                <td className="p-2 text-slate-500 whitespace-nowrap">{r.periodStart} → {r.periodEnd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatAuditDetails(v: Record<string, unknown> | null): string {
  if (!v) return "—";
  const rej = v.rejectionReason;
  const app = v.approvalComment;
  const legacy = v.reason;
  const parts: string[] = [];
  if (typeof rej === "string" && rej) parts.push(`Rejection: ${rej}`);
  if (typeof app === "string" && app) parts.push(`Approval notes: ${app}`);
  if (parts.length === 0 && typeof legacy === "string" && legacy) parts.push(String(legacy));
  return parts.length ? parts.join(" · ") : JSON.stringify(v);
}

export function ApprovalsView() {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailItem, setDetailItem] = useState<PendingItem | null>(null);
  const [approveItem, setApproveItem] = useState<PendingItem | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [rejectItem, setRejectItem] = useState<PendingItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/approvals?tab=${tab}`)
      .then((r) => (r.ok ? r.json() : { items: [], history: [] }))
      .then((d) => {
        if (tab === "pending") setPending(d.items ?? []);
        else setHistory(d.history ?? []);
      })
      .catch(() => {
        setPending([]);
        setHistory([]);
      })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (
    entityType: string,
    entityId: number,
    action: "APPROVED" | "REJECTED",
    opts?: { reason?: string; approvalComment?: string },
  ) => {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch("/api/approvals/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          action,
          reason: opts?.reason,
          approvalComment: opts?.approvalComment,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error || `Request failed (${res.status})`);
        setActing(false);
        return;
      }
      setApproveItem(null);
      setApproveComment("");
      setRejectItem(null);
      setRejectReason("");
      setDetailItem(null);
      load();
    } catch {
      setActionError("Network error");
    }
    setActing(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 max-w-3xl">
        Review the full incentive plan or target batch before approving. Rejections require a clear reason (stored on the plan and in the audit log).
        Optional approval comments are recorded in the audit trail.
      </p>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{actionError}</div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm rounded-lg border ${tab === "pending" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"}`}
        >
          Pending
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm rounded-lg border ${tab === "history" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"}`}
        >
          History
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading...</p>}

      {tab === "pending" && (
        <div className="space-y-4">
          {pending.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <StatusBadge status="SUBMITTED" />
                    <span className="text-xs font-medium text-slate-500 uppercase">{item.entityType}</span>
                    <span className="text-xs text-slate-400">{item.vertical}</span>
                  </div>
                  <h3 className="font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-600 mt-1">{item.summary}</p>
                  <p className="text-xs text-slate-400 mt-2">
                    Submitted by {item.submittedBy} · {new Date(item.submittedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Eye size={14} />
                      {item.entityType === "PLAN" ? "View incentive plan" : "View target details"}
                    </button>
                    {item.entityType === "PLAN" && (
                      <Link
                        href="/rules"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100"
                      >
                        <ExternalLink size={14} />
                        Open Rules workspace
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setApproveItem(item);
                    }}
                    disabled={acting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle size={16} />
                    Approve…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setRejectItem(item);
                      setRejectReason("");
                    }}
                    disabled={acting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <XCircle size={16} />
                    Reject…
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!loading && pending.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <FileText className="mx-auto text-slate-300 mb-2" size={32} />
              <p className="text-sm text-slate-500">No items pending approval.</p>
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3 text-left">Timestamp</th>
                <th className="p-3 text-left">Entity</th>
                <th className="p-3 text-left">ID</th>
                <th className="p-3 text-left">Action</th>
                <th className="p-3 text-left">By</th>
                <th className="p-3 text-left min-w-[200px]">Comments / reasons</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="p-3 text-xs whitespace-nowrap">{new Date(h.performedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="p-3">{h.entityType}</td>
                  <td className="p-3 font-mono text-xs">{h.entityId}</td>
                  <td className="p-3"><StatusBadge status={h.action} /></td>
                  <td className="p-3">{h.performedBy}</td>
                  <td className="p-3 text-xs text-slate-600">{formatAuditDetails(h.newValue)}</td>
                </tr>
              ))}
              {!loading && history.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">No audit history yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3 shrink-0">
              <h3 className="text-lg font-semibold text-slate-900 pr-4">
                {detailItem.entityType === "PLAN" ? "Incentive plan review" : "Target batch review"}
              </h3>
              <button type="button" onClick={() => setDetailItem(null)} className="rounded-lg p-2 hover:bg-slate-100 text-slate-500" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {detailItem.entityType === "PLAN" ? (
                <PlanDetailBody d={detailItem.planDetail} />
              ) : (
                <TargetDetailBody d={detailItem.targetDetail} />
              )}
            </div>
            <div className="border-t px-5 py-3 flex justify-end gap-2 shrink-0 bg-slate-50">
              <button type="button" onClick={() => setDetailItem(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {approveItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Approve submission</h3>
            <p className="text-sm text-slate-600">
              You are approving <strong>{approveItem.title}</strong>. Incentives will be recalculated for the current month after approval.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Approval notes (optional)</label>
              <textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="e.g. Verified slabs with category head — approved as proposed."
                className="w-full rounded-lg border border-slate-300 p-3 text-sm min-h-[88px]"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setApproveItem(null); setApproveComment(""); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAction(approveItem.entityType, approveItem.entityId, "APPROVED", {
                    approvalComment: approveComment.trim() || undefined,
                  })}
                disabled={acting}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {acting ? "Approving…" : "Confirm approval"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Reject submission</h3>
            <p className="text-sm text-slate-600">
              Provide a clear reason. For plans, this is saved as <strong>rejection reason</strong> on the plan record; all actions are logged in audit history.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reason (required, min 5 characters)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Multiplier band 90–99% does not match signed commercial terms — please resubmit."
                className="w-full rounded-lg border border-slate-300 p-3 text-sm min-h-[100px]"
                rows={4}
              />
              <p className="text-xs text-slate-400 mt-1">{rejectReason.trim().length} / 4000 · minimum 5</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setRejectItem(null); setRejectReason(""); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAction(rejectItem.entityType, rejectItem.entityId, "REJECTED", {
                    reason: rejectReason.trim(),
                  })}
                disabled={acting || rejectReason.trim().length < 5}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {acting ? "Rejecting…" : "Confirm rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
