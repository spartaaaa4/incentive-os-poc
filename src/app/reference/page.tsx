import { AppShell } from "@/components/layout/app-shell";
import { OrgReferenceView } from "@/components/reference/org-reference-view";
import { db } from "@/lib/db";

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export default async function ReferencePage() {
  const [employeesRaw, storesRaw, targetsRaw] = await Promise.all([
    db.employeeMaster.findMany({
      include: {
        store: true,
        credential: { select: { employerId: true, createdAt: true } },
      },
      orderBy: [{ storeCode: "asc" }, { employeeId: "asc" }],
    }),
    db.storeMaster.findMany({ orderBy: [{ vertical: "asc" }, { storeName: "asc" }] }),
    db.target.findMany({
      include: { store: { select: { storeName: true, vertical: true } } },
      orderBy: [{ vertical: "asc" }, { periodStart: "desc" }, { storeCode: "asc" }],
      take: 2000,
    }),
  ]);

  const employees = employeesRaw.map((e) => ({
    employeeId: e.employeeId,
    employeeName: e.employeeName,
    role: e.role,
    department: e.department,
    payrollStatus: e.payrollStatus,
    storeCode: e.storeCode,
    storeName: e.store.storeName,
    storeVertical: e.store.vertical,
    storeCity: e.store.city,
    storeState: e.store.state,
    dateOfJoining: e.dateOfJoining.toISOString().slice(0, 10),
    dateOfExit: e.dateOfExit ? e.dateOfExit.toISOString().slice(0, 10) : null,
    employerId: e.credential?.employerId ?? null,
    credentialCreatedAt: e.credential?.createdAt?.toISOString() ?? null,
  }));

  const stores = storesRaw.map((s) => ({
    storeCode: s.storeCode,
    storeName: s.storeName,
    vertical: s.vertical,
    storeFormat: s.storeFormat,
    state: s.state,
    city: s.city,
    storeStatus: s.storeStatus,
    operationalSince: s.operationalSince.toISOString().slice(0, 10),
  }));

  const targets = targetsRaw.map((t) => ({
    id: t.id,
    storeCode: t.storeCode,
    storeName: t.store.storeName,
    vertical: t.vertical,
    department: t.department,
    productFamilyName: t.productFamilyName,
    targetValue: Math.round(num(t.targetValue)),
    periodType: t.periodType,
    periodStart: t.periodStart.toISOString().slice(0, 10),
    periodEnd: t.periodEnd.toISOString().slice(0, 10),
    status: t.status,
    submittedBy: t.submittedBy,
    approvedBy: t.approvedBy,
    createdAt: t.createdAt.toISOString(),
  }));

  return (
    <AppShell title="Org & seed reference">
      <OrgReferenceView employees={employees} stores={stores} targets={targets} />
    </AppShell>
  );
}
