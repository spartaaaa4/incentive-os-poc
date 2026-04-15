"use client";

import { useMemo, useState } from "react";
import { Alert, Segmented, Space, Table, Tabs, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
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

export function OrgReferenceView(props: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  targets: TargetRow[];
}) {
  const { employees, stores, targets } = props;
  const [vertical, setVertical] = useState<Vertical>("ALL");
  const [panel, setPanel] = useState<"employees" | "stores" | "targets">("employees");

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

  const employeeColumns: ColumnsType<EmployeeRow> = [
    { title: "Employee ID", dataIndex: "employeeId", width: 110, render: (t: string) => <Typography.Text code copyable={{ text: t }}>{t}</Typography.Text> },
    { title: "Name", dataIndex: "employeeName" },
    { title: "Role", dataIndex: "role", width: 72 },
    { title: "Dept", dataIndex: "department", render: (v: string | null) => v ?? "—" },
    { title: "Payroll", dataIndex: "payrollStatus", width: 100 },
    { title: "Store code", dataIndex: "storeCode", width: 96, render: (t: string) => <Typography.Text code>{t}</Typography.Text> },
    { title: "Store name", dataIndex: "storeName" },
    { title: "Vertical", dataIndex: "storeVertical", width: 110 },
    { title: "City", dataIndex: "storeCity" },
    { title: "Join date", dataIndex: "dateOfJoining", width: 104 },
    { title: "Exit", dataIndex: "dateOfExit", width: 88, render: (v: string | null) => v ?? "—" },
    { title: "Login (employer ID)", dataIndex: "employerId", width: 140, render: (v: string | null) => v ?? "—" },
    {
      title: "Credential created",
      dataIndex: "credentialCreatedAt",
      width: 160,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—",
    },
  ];

  const storeColumns: ColumnsType<StoreRow> = [
    { title: "Store code", dataIndex: "storeCode", width: 100, render: (t: string) => <Typography.Text code>{t}</Typography.Text> },
    { title: "Store name", dataIndex: "storeName" },
    { title: "Vertical", dataIndex: "vertical", width: 110 },
    { title: "Format", dataIndex: "storeFormat" },
    { title: "City", dataIndex: "city" },
    { title: "State", dataIndex: "state" },
    { title: "Status", dataIndex: "storeStatus", width: 96 },
    { title: "Operational since", dataIndex: "operationalSince", width: 140 },
  ];

  const targetColumns: ColumnsType<TargetRow> = [
    { title: "ID", dataIndex: "id", width: 64 },
    {
      title: "Store",
      key: "store",
      render: (_, t) => (
        <Space direction="vertical" size={0}>
          <Typography.Text code>{t.storeCode}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.storeName}</Typography.Text>
        </Space>
      ),
    },
    { title: "Vertical", dataIndex: "vertical", width: 100 },
    {
      title: "Dept / family",
      key: "df",
      render: (_, t) => (
        <Space direction="vertical" size={0}>
          <span>{t.department ?? "—"}</span>
          {t.productFamilyName ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.productFamilyName}</Typography.Text> : null}
        </Space>
      ),
    },
    { title: "Target value", dataIndex: "targetValue", align: "right", render: (v: number) => formatInr(v) },
    { title: "Period type", dataIndex: "periodType", width: 110 },
    {
      title: "Period",
      key: "period",
      width: 200,
      render: (_, t) => `${t.periodStart} → ${t.periodEnd}`,
    },
    { title: "Status", dataIndex: "status", width: 100 },
    {
      title: "Submitted / approved",
      key: "sa",
      render: (_, t) => `${t.submittedBy ?? "—"} / ${t.approvedBy ?? "—"}`,
    },
    {
      title: "Row created",
      dataIndex: "createdAt",
      width: 160,
      render: (v: string) => new Date(v).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Alert
        type="warning"
        showIcon
        icon={<Info size={18} />}
        message={<Typography.Text strong>Demo / seed reference</Typography.Text>}
        description={
          <Typography.Paragraph style={{ marginBottom: 0 }} type="secondary">
            This page reflects what is currently in the database (typically from seed or your environment).{" "}
            <Typography.Text strong>Employee master</Typography.Text> does not store a row “created” timestamp — we show{" "}
            <Typography.Text strong>date of joining</Typography.Text> and, when present, when the{" "}
            <Typography.Text strong>login credential</Typography.Text> row was created (useful after seed runs).
          </Typography.Paragraph>
        }
      />

      <div>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
          Vertical
        </Typography.Text>
        <Segmented
          options={verticals.map((v) => ({ label: v.label, value: v.value }))}
          value={vertical}
          onChange={(v) => setVertical(v as Vertical)}
        />
      </div>

      <Tabs
        activeKey={panel}
        onChange={(k) => setPanel(k as "employees" | "stores" | "targets")}
        items={[
          {
            key: "employees",
            label: (
              <span>
                <Users size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Employees ({formatNumber(empFiltered.length)})
              </span>
            ),
            children: (
              <Table<EmployeeRow>
                rowKey="employeeId"
                size="small"
                scroll={{ x: "max-content" }}
                columns={employeeColumns}
                dataSource={empFiltered}
                pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100] }}
              />
            ),
          },
          {
            key: "stores",
            label: (
              <span>
                <Building2 size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Stores ({formatNumber(storeFiltered.length)})
              </span>
            ),
            children: (
              <Table<StoreRow>
                rowKey="storeCode"
                size="small"
                scroll={{ x: "max-content" }}
                columns={storeColumns}
                dataSource={storeFiltered}
                pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100] }}
              />
            ),
          },
          {
            key: "targets",
            label: (
              <span>
                <Target size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Targets ({formatNumber(targetFiltered.length)})
              </span>
            ),
            children: (
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Showing up to 2,000 target rows (newest periods first). Filter by vertical above.
                </Typography.Text>
                <Table<TargetRow>
                  rowKey="id"
                  size="small"
                  scroll={{ x: "max-content", y: "60vh" }}
                  columns={targetColumns}
                  dataSource={targetFiltered}
                  pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100] }}
                />
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
