"use client";

import { useCallback, useEffect, useState } from "react";
import { Shield, ShieldCheck, ShieldOff, Search, X } from "lucide-react";

type Vertical = "ELECTRONICS" | "GROCERY" | "FNL";
const ALL_VERTICALS: Vertical[] = ["ELECTRONICS", "GROCERY", "FNL"];

type FlagSet = {
  canViewAll: boolean;
  canEditIncentives: boolean;
  canSubmitApproval: boolean;
  canApprove: boolean;
  canManageUsers: boolean;
  canUploadData: boolean;
};

type AdminItem = {
  employeeId: string;
  employeeName: string;
  role: string;
  storeCode: string;
  storeName: string;
  vertical: Vertical;
  hasAdminAccess: boolean;
  adminAccess:
    | (FlagSet & {
        verticals: Vertical[];
        grantedBy: string | null;
        grantedAt: string | null;
        updatedAt: string | null;
      })
    | null;
};

const DEFAULT_FLAGS: FlagSet = {
  canViewAll: true,
  canEditIncentives: false,
  canSubmitApproval: false,
  canApprove: false,
  canManageUsers: false,
  canUploadData: false,
};

const FLAG_LABELS: Array<[keyof FlagSet, string, string]> = [
  ["canViewAll", "View all", "See dashboards/leaderboards across stores"],
  ["canEditIncentives", "Edit incentives", "Create + edit plans, slabs, campaigns"],
  ["canSubmitApproval", "Submit for approval", "Flip drafts → SUBMITTED"],
  ["canApprove", "Approve", "Decide on pending approval requests"],
  ["canUploadData", "Upload data", "Sales CSV + attendance uploads"],
  ["canManageUsers", "Manage users", "Grant/revoke admin access (super-admin only)"],
];

export function AdminsView() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminsOnly, setAdminsOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Grant modal state
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [flags, setFlags] = useState<FlagSet>(DEFAULT_FLAGS);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (adminsOnly) params.set("adminsOnly", "true");
    if (query.trim()) params.set("q", query.trim());
    fetch(`/api/admins?${params.toString()}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [adminsOnly, query]);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(item: AdminItem) {
    setEditing(item);
    setSaveErr(null);
    const a = item.adminAccess;
    if (a) {
      setSuperAdmin(a.verticals.length === 0);
      setVerticals(a.verticals);
      setFlags({
        canViewAll: a.canViewAll,
        canEditIncentives: a.canEditIncentives,
        canSubmitApproval: a.canSubmitApproval,
        canApprove: a.canApprove,
        canManageUsers: a.canManageUsers,
        canUploadData: a.canUploadData,
      });
    } else {
      setSuperAdmin(false);
      setVerticals([item.vertical]);
      setFlags(DEFAULT_FLAGS);
    }
  }

  function toggleVertical(v: Vertical) {
    setVerticals((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function submitGrant() {
    if (!editing) return;
    if (!superAdmin && verticals.length === 0) {
      setSaveErr("Select at least one vertical, or enable super-admin.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/admins/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: editing.employeeId,
          verticals: superAdmin ? [] : verticals,
          ...flags,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveErr(body.error || `Request failed (${res.status})`);
        setSaving(false);
        return;
      }
      setEditing(null);
      load();
    } catch {
      setSaveErr("Network error");
    }
    setSaving(false);
  }

  async function revoke(item: AdminItem) {
    if (!confirm(`Revoke admin access for ${item.employeeName} (${item.employeeId})?`)) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/admins/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeId: item.employeeId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || `Revoke failed (${res.status})`);
      }
      load();
    } catch {
      alert("Network error");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={adminsOnly}
            onChange={(e) => setAdminsOnly(e.target.checked)}
          />
          Admins only
        </label>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID or name"
            className="pl-7 pr-3 py-2 text-sm rounded-lg border border-slate-300 w-64"
          />
        </div>
        {loading && <span className="text-xs text-slate-400">Loading…</span>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Employee</th>
              <th className="p-3 text-left">Store / Vertical</th>
              <th className="p-3 text-left">Scope</th>
              <th className="p-3 text-left">Permissions</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const a = item.adminAccess;
              return (
                <tr key={item.employeeId} className="border-t border-slate-100 align-top">
                  <td className="p-3">
                    <div className="font-medium text-slate-900">{item.employeeName}</div>
                    <div className="text-xs text-slate-500 font-mono">{item.employeeId} · {item.role}</div>
                  </td>
                  <td className="p-3">
                    <div className="text-slate-800">{item.storeName}</div>
                    <div className="text-xs text-slate-500">{item.vertical} · {item.storeCode}</div>
                  </td>
                  <td className="p-3 text-xs">
                    {!item.hasAdminAccess || !a ? (
                      <span className="text-slate-400">No admin access</span>
                    ) : a.verticals.length === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 font-medium">
                        <ShieldCheck size={12} /> Super-admin (all verticals)
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {a.verticals.map((v) => (
                          <span key={v} className="rounded-full bg-blue-50 text-blue-800 border border-blue-100 px-2 py-0.5 font-medium">
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    {!a ? (
                      "—"
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {FLAG_LABELS.filter(([k]) => a[k]).map(([k, label]) => (
                          <span key={k} className="rounded bg-slate-100 border border-slate-200 px-2 py-0.5 text-slate-700">
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 mr-2"
                    >
                      <Shield size={12} /> {item.hasAdminAccess ? "Edit" : "Grant"}
                    </button>
                    {item.hasAdminAccess && (
                      <button
                        type="button"
                        onClick={() => revoke(item)}
                        disabled={saving}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <ShieldOff size={12} /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-500">No employees match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h3 className="text-lg font-semibold text-slate-900">
                {editing.hasAdminAccess ? "Edit admin access" : "Grant admin access"}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-2 hover:bg-slate-100 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div className="text-sm">
                <div className="font-medium text-slate-900">{editing.employeeName}</div>
                <div className="text-xs text-slate-500 font-mono">{editing.employeeId} · {editing.role} · {editing.storeName} ({editing.vertical})</div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Vertical scope</p>
                <label className="inline-flex items-center gap-2 text-sm mb-2">
                  <input
                    type="checkbox"
                    checked={superAdmin}
                    onChange={(e) => setSuperAdmin(e.target.checked)}
                  />
                  <span className="font-medium text-amber-800">Super-admin (all verticals)</span>
                </label>
                {!superAdmin && (
                  <div className="flex flex-wrap gap-2">
                    {ALL_VERTICALS.map((v) => (
                      <label key={v} className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-2.5 py-1">
                        <input
                          type="checkbox"
                          checked={verticals.includes(v)}
                          onChange={() => toggleVertical(v)}
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Permissions</p>
                <div className="space-y-1.5">
                  {FLAG_LABELS.map(([k, label, desc]) => (
                    <label key={k} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={flags[k]}
                        onChange={(e) => setFlags((prev) => ({ ...prev, [k]: e.target.checked }))}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-slate-800">{label}</span>
                        <span className="text-xs text-slate-500 block">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {saveErr && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{saveErr}</div>}
            </div>
            <div className="border-t px-5 py-3 flex justify-end gap-2 bg-slate-50">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-white">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitGrant}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
