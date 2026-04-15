"use client";

import { useMemo, useState } from "react";
import { formatInr, formatNumber } from "@/lib/format";
import { Building2, Users, Target, Info } from "lucide-react";

type Vertical = "ALL" | "ELECTRONICS" | "GROCERY" | "FNL";

type EmployeeRow = {
  employeeId: string;
  employeeName: string;
  role: string;
  department: string | null;
  payrollStatus: string;
  storeCode: string;
  storeName: string;
  storeVertical: string;
  storeCity: string;
  storeState: string;
  dateOfJoining: string;
  dateOfExit: string | null;
  employerId: string | null;
  credentialCreatedAt: string | null;
};

type StoreRow = {
  storeCode: string;
  storeName: string;
  vertical: string;
  storeFormat: string;
  state: string;
  city: string;
  storeStatus: string;
  operationalSince: string;
};

type TargetRow = {
  id: number;
  storeCode: string;
  storeName: string;
  vertical: string;
  department: string | null;
  productFamilyName: string | null;
  targetValue: number;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  submittedBy: string | null;
  approvedBy: string | null;
  createdAt: string;
};

const verticals: Array<{ value: Vertical; label: string }> = [
  { value: "ALL", label: "All verticals" },
  { value: "ELECTRONICS", label: "Electronics" },
  { value: "GROCERY", label: "Grocery" },
  { value: "FNL", label: "F&L" },
];

type Panel = "employees" | "stores" | "targets";

export function OrgReferenceView(props: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  targets: TargetRow[];
}) {
  const { employees, stores, targets } = props;
  const [vertical, setVertical] = useState<Vertical>("ALL");
  const [panel, setPanel] = useState<Panel>("employees");

  const empFiltered = useMemo(
    () =>
      vertical === "ALL"
        ? employees
        : employees.filter((e) => e.storeVertical === vertical),
    [employees, vertical],
  );

  const storeFiltered = useMemo(
    () => (vertical === "ALL" ? stores : stores.filter((s) => s.vertical === vertical)),
    [stores, vertical],
  );

  const targetFiltered = useMemo(
    () => (vertical === "ALL" ? targets : targets.filter((t) => t.vertical === vertical)),
    [targets, vertical],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 flex gap-3 text-sm text-amber-950">
        <Info className="shrink-0 mt-0.5" size={18} />
        <div>
          <p className="font-medium">Demo / seed reference</p>
          <p className="text-amber-900/90 mt-1 leading-relaxed">
            This page reflects what is currently in the database (typically from seed or your environment).{" "}
            <strong>Employee master</strong> does not store a row “created” timestamp — we show{" "}
            <strong>date of joining</strong> and, when present, when the <strong>login credential</strong> row was created (useful after seed runs).
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vertical</p>
        <div className="flex flex-wrap gap-2">
          {verticals.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setVertical(v.value)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                vertical === v.value
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/50"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {(
          [
            { id: "employees" as const, label: "Employees", icon: Users, count: empFiltered.length },
            { id: "stores" as const, label: "Stores", icon: Building2, count: storeFiltered.length },
            { id: "targets" as const, label: "Targets", icon: Target, count: targetFiltered.length },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPanel(t.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                panel === t.id
                  ? "border-blue-600 bg-blue-50 text-blue-900"
                  : "border-transparent text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={16} />
              {t.label}
              <span className="text-xs tabular-nums text-slate-400">({formatNumber(t.count)})</span>
            </button>
          );
        })}
      </div>

      {panel === "employees" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-3">Employee ID</th>
                <th className="p-3">Name</th>
                <th className="p-3">Role</th>
                <th className="p-3">Dept</th>
                <th className="p-3">Payroll</th>
                <th className="p-3">Store code</th>
                <th className="p-3">Store name</th>
                <th className="p-3">Vertical</th>
                <th className="p-3">City</th>
                <th className="p-3">Join date</th>
                <th className="p-3">Exit</th>
                <th className="p-3">Login (employer ID)</th>
                <th className="p-3">Credential created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {empFiltered.map((e) => (
                <tr key={e.employeeId} className="hover:bg-slate-50/80">
                  <td className="p-2.5 font-mono text-xs text-slate-700">{e.employeeId}</td>
                  <td className="p-2.5 font-medium text-slate-900">{e.employeeName}</td>
                  <td className="p-2.5 text-slate-600">{e.role}</td>
                  <td className="p-2.5 text-slate-500">{e.department ?? "—"}</td>
                  <td className="p-2.5 text-xs">{e.payrollStatus}</td>
                  <td className="p-2.5 font-mono text-xs">{e.storeCode}</td>
                  <td className="p-2.5 text-slate-700">{e.storeName}</td>
                  <td className="p-2.5 text-xs">{e.storeVertical}</td>
                  <td className="p-2.5 text-slate-600">{e.storeCity}</td>
                  <td className="p-2.5 text-xs whitespace-nowrap">{e.dateOfJoining}</td>
                  <td className="p-2.5 text-xs">{e.dateOfExit ?? "—"}</td>
                  <td className="p-2.5 font-mono text-xs">{e.employerId ?? "—"}</td>
                  <td className="p-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {e.credentialCreatedAt
                      ? new Date(e.credentialCreatedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel === "stores" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-3">Store code</th>
                <th className="p-3">Store name</th>
                <th className="p-3">Vertical</th>
                <th className="p-3">Format</th>
                <th className="p-3">City</th>
                <th className="p-3">State</th>
                <th className="p-3">Status</th>
                <th className="p-3">Operational since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {storeFiltered.map((s) => (
                <tr key={s.storeCode} className="hover:bg-slate-50/80">
                  <td className="p-2.5 font-mono text-xs font-medium">{s.storeCode}</td>
                  <td className="p-2.5 text-slate-900">{s.storeName}</td>
                  <td className="p-2.5 text-xs">{s.vertical}</td>
                  <td className="p-2.5 text-slate-600">{s.storeFormat}</td>
                  <td className="p-2.5">{s.city}</td>
                  <td className="p-2.5 text-slate-600">{s.state}</td>
                  <td className="p-2.5 text-xs">{s.storeStatus}</td>
                  <td className="p-2.5 text-xs whitespace-nowrap">{s.operationalSince}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel === "targets" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Showing up to 2,000 target rows (newest periods first). Filter by vertical above.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Store</th>
                  <th className="p-3">Vertical</th>
                  <th className="p-3">Dept / family</th>
                  <th className="p-3 text-right">Target value</th>
                  <th className="p-3">Period type</th>
                  <th className="p-3">Period</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Submitted / approved</th>
                  <th className="p-3">Row created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {targetFiltered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <td className="p-2.5 font-mono text-xs">{t.id}</td>
                    <td className="p-2.5">
                      <div className="font-mono text-xs">{t.storeCode}</div>
                      <div className="text-slate-600 text-xs">{t.storeName}</div>
                    </td>
                    <td className="p-2.5 text-xs">{t.vertical}</td>
                    <td className="p-2.5 text-xs text-slate-600">
                      {t.department ?? "—"}
                      {t.productFamilyName && <div>{t.productFamilyName}</div>}
                    </td>
                    <td className="p-2.5 text-right font-medium tabular-nums">{formatInr(t.targetValue)}</td>
                    <td className="p-2.5 text-xs">{t.periodType}</td>
                    <td className="p-2.5 text-xs whitespace-nowrap">
                      {t.periodStart} → {t.periodEnd}
                    </td>
                    <td className="p-2.5 text-xs">{t.status}</td>
                    <td className="p-2.5 text-xs text-slate-600">
                      {t.submittedBy ?? "—"} / {t.approvedBy ?? "—"}
                    </td>
                    <td className="p-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                    </td>
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
