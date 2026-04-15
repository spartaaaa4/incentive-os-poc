"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type ReactNode } from "react";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ChevronRight,
  ArrowLeft,
  TrendingUp,
  Users,
  MapPin,
  Store,
  User,
  ShoppingBag,
  IndianRupee,
  Target,
} from "lucide-react";
import { formatInr, formatNumber } from "@/lib/format";

type Breadcrumb = { label: string; params: Record<string, string> };

export const IncentiveDrilldown = forwardRef<
  { drillToStore: (storeCode: string, storeName: string) => void },
  {
    vertical: string;
    month?: string;
    onEnterCityStores?: () => void;
    onReturnToDrilldownRoot?: () => void;
  }
>(function IncentiveDrilldown({ vertical, month, onEnterCityStores, onReturnToDrilldownRoot }, ref) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [crumbs, setCrumbs] = useState<Breadcrumb[]>([{ label: "All Cities", params: {} }]);

  const load = useCallback((p: Record<string, string>, v: string, m?: string) => {
    setLoading(true);
    const extra: Record<string, string> = {};
    if (v) extra.vertical = v;
    if (m) {
      const anchor = new Date(m + "-15");
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      extra.periodStart = start.toISOString().slice(0, 10);
      extra.periodEnd = end.toISOString().slice(0, 10);
    }
    const qs = new URLSearchParams({ ...p, ...extra }).toString();
    fetch(`/api/incentives?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(params, vertical, month); }, [params, vertical, month, load]);

  useEffect(() => {
    setCrumbs([{ label: "All Cities", params: {} }]);
    setParams({});
    onReturnToDrilldownRoot?.();
  }, [vertical, month, onReturnToDrilldownRoot]);

  const drillTo = (label: string, newParams: Record<string, string>) => {
    setCrumbs((prev) => [...prev, { label, params: newParams }]);
    setParams(newParams);
    if (newParams.city && !newParams.storeCode && !newParams.employeeId) {
      onEnterCityStores?.();
    }
  };

  const goBack = () => {
    setCrumbs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const rootParams = next[next.length - 1].params;
      setParams(rootParams);
      if (next.length === 1 && Object.keys(rootParams).length === 0) {
        queueMicrotask(() => onReturnToDrilldownRoot?.());
      }
      return next;
    });
  };

  const goTo = (idx: number) => {
    setCrumbs((prev) => {
      const next = prev.slice(0, idx + 1);
      const p = next[next.length - 1].params;
      setParams(p);
      if (next.length === 1 && Object.keys(p).length === 0) {
        queueMicrotask(() => onReturnToDrilldownRoot?.());
      }
      return next;
    });
  };

  // Expose drillToStore for parent (below-threshold click)
  useImperativeHandle(ref, () => ({
    drillToStore(storeCode: string, storeName: string) {
      const newParams = { storeCode };
      setCrumbs([{ label: "All Cities", params: {} }, { label: storeName, params: newParams }]);
      setParams(newParams);
    },
  }));

  const level = (data as { level?: string })?.level;

  const breadcrumbItems = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return {
      key: String(i),
      title: last ? (
        <Typography.Text strong>{c.label}</Typography.Text>
      ) : (
        <Typography.Link onClick={() => goTo(i)}>{c.label}</Typography.Link>
      ),
    };
  });

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Flex align="center" gap={8} wrap="wrap">
        {crumbs.length > 1 ? (
          <Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={goBack} aria-label="Back" />
        ) : null}
        <Breadcrumb items={breadcrumbItems} separator={<ChevronRight size={12} />} />
      </Flex>

      <Spin spinning={loading} tip="Loading…">
        <div style={{ minHeight: 80 }}>
          {!loading && data && level === "city" && <CityView data={data} onDrill={drillTo} />}
          {!loading && data && level === "store" && <StoreView data={data} onDrill={drillTo} />}
          {!loading && data && level === "storeDetail" && <StoreDetailView data={data} onDrill={drillTo} />}
          {!loading && data && level === "employeeDetail" && <EmployeeDetailView data={data} />}
        </div>
      </Spin>
    </Space>
  );
});

function StatCard({ icon, label, value, valueColor }: { icon: ReactNode; label: string; value: string; valueColor?: string }) {
  return (
    <Card size="small" styles={{ body: { padding: 12 } }}>
      <Flex align="center" gap={12}>
        <div style={{ borderRadius: 8, padding: 8, background: "#f1f5f9", color: "#64748b" }}>{icon}</div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>{label}</Typography.Text>
          <Typography.Text strong style={{ fontSize: 16, color: valueColor }}>{value}</Typography.Text>
        </div>
      </Flex>
    </Card>
  );
}

function AchievementBar({ pct }: { pct: number }) {
  const p = Math.min(150, Math.max(0, pct));
  const stroke = pct >= 100 ? "#10b981" : pct >= 85 ? "#f59e0b" : "#ef4444";
  return <Progress percent={Math.round((p / 150) * 100)} showInfo={false} strokeColor={stroke} trailColor="#f1f5f9" size="small" style={{ marginBottom: 0 }} />;
}

// ── Level 1: Cities ──
function CityView({ data, onDrill }: { data: Record<string, unknown>; onDrill: (label: string, p: Record<string, string>) => void }) {
  const summary = data.summary as { totalIncentive: number; totalEmployees: number; employeesEarning: number; totalSales: number; storeCount: number };
  const rows = data.rows as Array<{ city: string; state: string; storeCount: number; employeeCount: number; totalEmployees: number; totalSales: number; totalIncentive: number; avgAchievementPct: number }>;
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} lg={6}><StatCard icon={<ShoppingBag size={16} />} label="Sales (this month)" value={formatInr(summary.totalSales)} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Incentives (this month)" value={formatInr(summary.totalIncentive)} valueColor="#047857" /></Col>
        <Col xs={12} lg={6}><StatCard icon={<Users size={16} />} label="Associates earning" value={`${formatNumber(summary.employeesEarning)} / ${formatNumber(summary.totalEmployees)}`} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<Store size={16} />} label="Stores" value={formatNumber(summary.storeCount)} /></Col>
      </Row>
      <Row gutter={[12, 12]}>
        {rows.map((r) => (
          <Col xs={24} md={12} lg={8} key={r.city}>
            <Card hoverable onClick={() => onDrill(r.city, { city: r.city })} styles={{ body: { padding: 16 } }}>
              <Flex justify="space-between" align="flex-start" style={{ marginBottom: 8 }}>
                <Space>
                  <MapPin size={14} style={{ color: "#94a3b8" }} />
                  <Typography.Text strong>{r.city}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.state}</Typography.Text>
                </Space>
                <ChevronRight size={14} style={{ color: "#cbd5e1" }} />
              </Flex>
              <AchievementBar pct={r.avgAchievementPct} />
              <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>
                Avg achievement {r.avgAchievementPct}%
              </Typography.Text>
              <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
                <Col span={12}><Typography.Text type="secondary" style={{ fontSize: 11 }}>Sales</Typography.Text><div><Typography.Text>{formatInr(r.totalSales)}</Typography.Text></div></Col>
                <Col span={12}><Typography.Text type="secondary" style={{ fontSize: 11 }}>Incentive</Typography.Text><div><Typography.Text style={{ color: "#047857" }}>{formatInr(r.totalIncentive)}</Typography.Text></div></Col>
                <Col span={12}><Typography.Text type="secondary" style={{ fontSize: 11 }}>Stores</Typography.Text><div><Typography.Text>{r.storeCount}</Typography.Text></div></Col>
                <Col span={12}><Typography.Text type="secondary" style={{ fontSize: 11 }}>Earning</Typography.Text><div><Typography.Text>{r.employeeCount} / {r.totalEmployees}</Typography.Text></div></Col>
              </Row>
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
}

// ── Level 2: Stores ──
type StoreRow = { storeCode: string; storeName: string; vertical: string; storeFormat: string; employeeCount: number; totalIncentive: number; achievementPct: number; target: number; actual: number };
function StoreView({ data, onDrill }: { data: Record<string, unknown>; onDrill: (label: string, p: Record<string, string>) => void }) {
  const summary = data.summary as { city: string; totalIncentive: number; storeCount: number };
  const rows = data.rows as StoreRow[];

  const columns: ColumnsType<StoreRow> = [
    {
      title: "Store",
      key: "store",
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{r.storeName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.storeCode} · {r.storeFormat}</Typography.Text>
        </Space>
      ),
    },
    { title: "Vertical", dataIndex: "vertical", width: 110 },
    { title: "Target", dataIndex: "target", align: "right", sorter: (a, b) => a.target - b.target, render: (v: number) => formatInr(v) },
    { title: "Actual", dataIndex: "actual", align: "right", sorter: (a, b) => a.actual - b.actual, render: (v: number) => formatInr(v) },
    {
      title: "Achievement",
      dataIndex: "achievementPct",
      align: "center",
      sorter: (a, b) => a.achievementPct - b.achievementPct,
      render: (pct: number) => (
        <Flex align="center" gap={8} justify="center">
          <div style={{ width: 80 }}><AchievementBar pct={pct} /></div>
          <Typography.Text style={{ width: 40 }}>{pct}%</Typography.Text>
        </Flex>
      ),
    },
    {
      title: "Incentive",
      dataIndex: "totalIncentive",
      align: "right",
      defaultSortOrder: "descend",
      sorter: (a, b) => a.totalIncentive - b.totalIncentive,
      render: (v: number) => formatInr(v),
    },
    { title: "Employees", dataIndex: "employeeCount", align: "center", sorter: (a, b) => a.employeeCount - b.employeeCount },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={8}><StatCard icon={<MapPin size={16} />} label="City" value={summary.city} /></Col>
        <Col xs={24} sm={8}><StatCard icon={<TrendingUp size={16} />} label="Total incentive" value={formatInr(summary.totalIncentive)} valueColor="#047857" /></Col>
        <Col xs={24} sm={8}><StatCard icon={<Store size={16} />} label="Stores" value={formatNumber(summary.storeCount)} /></Col>
      </Row>
      <Table<StoreRow>
        rowKey="storeCode"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        onRow={(r) => ({
          onClick: () => onDrill(r.storeName, { city: summary.city, storeCode: r.storeCode }),
          style: { cursor: "pointer" },
        })}
      />
    </Space>
  );
}

// ── Level 3: Store Detail (departments + employees) ──
type EmpRow = { employeeId: string; employeeName: string; role: string; baseIncentive: number; multiplierPct: number; achievementPct: number; finalIncentive: number };
type StoreDetailSummary = {
  storeCode?: string;
  storeName?: string;
  vertical?: string;
  city?: string;
  /** @deprecated same as totalIncentiveEarned */
  totalIncentive?: number;
  totalIncentiveEarned?: number;
  totalBaseIncentive?: number;
  totalStoreSales?: number;
  totalStoreTarget?: number;
  storeAchievementPct?: number;
  employeeCount?: number;
  totalEmployees?: number;
};

function StoreDetailView({ data, onDrill }: { data: Record<string, unknown>; onDrill: (label: string, p: Record<string, string>) => void }) {
  const summary = data.summary as StoreDetailSummary;
  const departments = data.departments as Array<{ department: string; vertical: string; target: number; actual: number; achievementPct: number }>;
  const employees = data.employees as EmpRow[];

  const totalSales =
    summary.totalStoreSales ??
    (departments.length ? departments.reduce((s, d) => s + d.actual, 0) : 0);
  const totalTarget =
    summary.totalStoreTarget ??
    (departments.length ? departments.reduce((s, d) => s + d.target, 0) : 0);
  const storeAchievementPct =
    summary.storeAchievementPct ??
    (totalTarget > 0 ? Math.round((totalSales / totalTarget) * 1000) / 10 : 0);
  const incentiveEarned = summary.totalIncentiveEarned ?? summary.totalIncentive ?? 0;
  const eligibleBase = summary.totalBaseIncentive ?? employees.reduce((s, e) => s + e.baseIncentive, 0);
  const empCount = summary.employeeCount ?? employees.length;
  const totalEmps = summary.totalEmployees ?? empCount;

  const deptColumns: ColumnsType<(typeof departments)[number]> = [
    { title: "Department", dataIndex: "department" },
    { title: "Target", dataIndex: "target", align: "right", render: (v: number) => formatInr(v) },
    { title: "Actual", dataIndex: "actual", align: "right", render: (v: number) => formatInr(v) },
    {
      title: "Achievement",
      dataIndex: "achievementPct",
      align: "center",
      render: (pct: number) => (
        <Flex align="center" gap={8} justify="center">
          <div style={{ width: 72 }}><AchievementBar pct={pct} /></div>
          <Typography.Text style={{ width: 36 }}>{pct}%</Typography.Text>
        </Flex>
      ),
    },
  ];

  const empColumns: ColumnsType<EmpRow> = [
    {
      title: "Employee",
      key: "emp",
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{r.employeeName}</Typography.Text>
          <Typography.Text type="secondary" code style={{ fontSize: 11 }}>{r.employeeId}</Typography.Text>
        </Space>
      ),
    },
    { title: "Role", dataIndex: "role", width: 80 },
    { title: "Eligible incentive", dataIndex: "baseIncentive", align: "right", sorter: (a, b) => a.baseIncentive - b.baseIncentive, render: (v: number) => formatInr(v) },
    {
      title: "Multiplier",
      dataIndex: "multiplierPct",
      align: "right",
      sorter: (a, b) => a.multiplierPct - b.multiplierPct,
      render: (v: number) => (v > 0 ? `${v}%` : "—"),
    },
    {
      title: "Earned incentive",
      dataIndex: "finalIncentive",
      align: "right",
      defaultSortOrder: "descend",
      sorter: (a, b) => a.finalIncentive - b.finalIncentive,
      render: (v: number) => <Typography.Text strong style={{ color: "#047857" }}>{formatInr(v)}</Typography.Text>,
    },
  ];

  const drillEmployee = (r: EmpRow) => {
    if (!summary.storeCode) return;
    const p: Record<string, string> = { employeeId: r.employeeId, storeCode: summary.storeCode };
    if (summary.city) p.city = summary.city;
    onDrill(r.employeeName, p);
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small" styles={{ body: { padding: 20 } }}>
        <Flex align="center" justify="space-between" wrap="wrap" gap={12} style={{ marginBottom: 16 }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {summary.storeName ?? summary.storeCode ?? "Store"}
            </Typography.Title>
            <Space size={8} wrap style={{ marginTop: 8 }}>
              {summary.storeCode ? <Tag>Store code: {summary.storeCode}</Tag> : null}
              {summary.vertical ? <Tag color="blue">{summary.vertical}</Tag> : null}
              {summary.city ? <Tag icon={<MapPin size={12} />}>{summary.city}</Tag> : null}
            </Space>
          </div>
          <div style={{ maxWidth: 280 }}>
            <StatCard
              icon={<Users size={16} />}
              label="People (ledger rows / active)"
              value={`${formatNumber(empCount)} / ${formatNumber(totalEmps)}`}
            />
          </div>
        </Flex>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 16, maxWidth: 720 }}>
          <strong>Sales</strong> and <strong>targets</strong> are rolled up from every department below. <strong>Incentive earned</strong> is the sum of
          credited payouts in the ledger for this month. <strong>Eligible (base)</strong> is the sum of pre-multiplier amounts before achievement slabs are applied.
        </Typography.Paragraph>

        {totalSales > 0 && incentiveEarned === 0 && employees.length === 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Sales are recorded, but no incentive ledger rows yet"
            description="You will see ₹0 earned until incentives are calculated for this store and period (e.g. run recalculation from the dashboard or confirm active plans and eligibility)."
          />
        ) : null}

        <Typography.Text strong style={{ display: "block", marginBottom: 12, fontSize: 13 }}>
          Sales vs target (whole store)
        </Typography.Text>
        <Row gutter={[16, 20]}>
          <Col xs={24} md={8}>
            <Card size="small" variant="borderless" style={{ background: "#eff6ff" }}>
              <Space align="start">
                <ShoppingBag size={22} style={{ color: "#2563eb", marginTop: 4 }} />
                <Statistic title="Total sales (store)" value={totalSales} formatter={(v) => formatInr(Number(v))} valueStyle={{ color: "#1e40af", fontWeight: 700 }} />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                Gross offline sales, all departments combined
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" variant="borderless" style={{ background: "#f0fdf4" }}>
              <Space align="start">
                <Target size={22} style={{ color: "#059669", marginTop: 4 }} />
                <Statistic title="Total target (store)" value={totalTarget} formatter={(v) => formatInr(Number(v))} valueStyle={{ color: "#065f46", fontWeight: 700 }} />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                Sum of active department targets for this month
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" variant="borderless" style={{ background: "#fffbeb" }}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space align="center">
                  <TrendingUp size={22} style={{ color: "#d97706" }} />
                  <Statistic title="Store achievement" value={storeAchievementPct} suffix="%" valueStyle={{ color: "#92400e", fontWeight: 700 }} />
                </Space>
                <Progress percent={Math.min(100, storeAchievementPct)} showInfo={false} strokeColor="#f59e0b" />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Total sales ÷ total target
                </Typography.Text>
              </Space>
            </Card>
          </Col>
        </Row>

        <Divider style={{ margin: "20px 0" }} />

        <Typography.Text strong style={{ display: "block", marginBottom: 12, fontSize: 13 }}>
          Incentives (whole store)
        </Typography.Text>
        <Row gutter={[16, 20]}>
          <Col xs={24} md={8}>
            <Card size="small" variant="borderless" style={{ background: "#ecfdf5" }}>
              <Space align="start">
                <IndianRupee size={22} style={{ color: "#047857", marginTop: 4 }} />
                <Statistic
                  title="Incentive earned (credited)"
                  value={incentiveEarned}
                  formatter={(v) => formatInr(Number(v))}
                  valueStyle={{ color: "#047857", fontWeight: 700 }}
                />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                Sum of final payout in the ledger for this month (what is attributed to people below)
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" variant="borderless" style={{ background: "#f5f3ff" }}>
              <Space align="start">
                <IndianRupee size={22} style={{ color: "#5b21b6", marginTop: 4 }} />
                <Statistic
                  title="Eligible incentive (base pool)"
                  value={eligibleBase}
                  formatter={(v) => formatInr(Number(v))}
                  valueStyle={{ color: "#5b21b6", fontWeight: 700 }}
                />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                Pre-multiplier total from rules — before achievement slabs adjust what gets paid
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" variant="borderless" style={{ background: "#fafafa" }}>
              <Statistic
                title="Earned vs eligible (summary)"
                value={eligibleBase > 0 ? Math.round((incentiveEarned / eligibleBase) * 1000) / 10 : 0}
                suffix="%"
                valueStyle={{ fontWeight: 700 }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                {eligibleBase > 0
                  ? `Credited ${formatInr(incentiveEarned)} of ${formatInr(eligibleBase)} base pool`
                  : "No base amounts in ledger yet"}
              </Typography.Text>
            </Card>
          </Col>
        </Row>
      </Card>

      {departments.length > 0 ? (
        <Card title="Department targets & achievement" size="small">
          <Table
            rowKey="department"
            size="small"
            pagination={false}
            columns={deptColumns}
            dataSource={departments}
          />
        </Card>
      ) : null}

      <Card title="Employee incentives" size="small">
        <Table<EmpRow>
          rowKey="employeeId"
          size="small"
          pagination={false}
          columns={empColumns}
          dataSource={employees}
          locale={{ emptyText: "No incentive data for this period" }}
          onRow={(r) => ({
            onClick: () => drillEmployee(r),
            style: { cursor: "pointer" },
          })}
        />
      </Card>
    </Space>
  );
}

// ── Level 5: Employee detail card ──
function EmployeeDetailView({ data }: { data: Record<string, unknown> }) {
  const emp = data.employee as { employeeId: string; employeeName: string; role: string; storeCode: string; storeName: string } | undefined;
  const vertical = data.vertical as string;
  const message = data.message as string;
  const period = data.period as { start: string; end: string };

  if (!emp) return <Typography.Text type="secondary">Employee not found.</Typography.Text>;

  const firstName = emp.employeeName.split(" ")[0];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card>
        <Flex align="center" gap={12} style={{ marginBottom: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "#dbeafe",
              color: "#1d4ed8",
              fontWeight: 700,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {emp.employeeName.split(" ").map((w) => w[0]).join("").slice(0, 2)}
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>{emp.employeeName}</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {emp.role} · {emp.storeCode} — {emp.storeName} · {period.start} to {period.end}
            </Typography.Text>
          </div>
        </Flex>
        <Typography.Paragraph style={{ marginBottom: 0, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 12 }}>
          {message}
        </Typography.Paragraph>
      </Card>

      {vertical === "ELECTRONICS" && <ElectronicsDetail data={data} firstName={firstName} />}
      {vertical === "GROCERY" && <GroceryDetail data={data} firstName={firstName} />}
      {vertical === "FNL" && <FnlDetail data={data} firstName={firstName} />}
    </Space>
  );
}

type SaleItem = { date: string; brand: string; productFamily: string; articleCode: string; quantity: number; unitPrice: number; grossAmount: number; incentiveEarned: number };

function ElectronicsDetail({ data, firstName }: { data: Record<string, unknown>; firstName: string }) {
  const standing = data.currentStanding as { departmentTarget?: number; departmentActual?: number; storeTarget: number; storeActual: number; achievementPct: number; currentMultiplierPct: number; baseIncentive: number; finalIncentive: number; employeeDepartment?: string } | null;
  const tiers = data.multiplierTiers as Array<{ from: number; to: number; multiplierPct: number; isCurrentTier: boolean; incentiveAtTier: number }>;
  const departments = data.departments as Array<{ department: string; target: number; actual: number; achievementPct: number }> | undefined;
  const sales = data.recentSales as SaleItem[] | undefined;
  if (!standing) return null;

  const target = standing.departmentTarget ?? standing.storeTarget;
  const actual = standing.departmentActual ?? standing.storeActual;

  return (
    <>
      <Row gutter={[12, 12]}>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label={standing.employeeDepartment ? "Dept achievement" : "Store achievement"} value={`${standing.achievementPct}%`} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Multiplier" value={`${standing.currentMultiplierPct}%`} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Base incentive" value={formatInr(standing.baseIncentive)} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Final incentive" value={formatInr(standing.finalIncentive)} valueColor="#047857" /></Col>
      </Row>

      {/* Incentive calculation explainer */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">How {firstName}&apos;s incentive is calculated</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>1. Each product sold earns a <strong>per-unit incentive</strong> based on its product family, brand, and price slab.</p>
          <p>2. Total per-unit incentives sum to <strong>Base Incentive: {formatInr(standing.baseIncentive)}</strong></p>
          <p>3. {standing.employeeDepartment ? `${standing.employeeDepartment} department` : "Store"} achievement is <strong>{standing.achievementPct}%</strong>, which unlocks a <strong>{standing.currentMultiplierPct}% multiplier</strong></p>
          <p>4. <strong>Final = Base × Multiplier = {formatInr(standing.baseIncentive)} × {standing.currentMultiplierPct}% = {formatInr(standing.finalIncentive)}</strong></p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-1">{standing.employeeDepartment ? "Department" : "Store"} Progress</h4>
        <p className="text-xs text-slate-500 mb-3">Target: {formatInr(target)} | Actual: {formatInr(actual)}</p>
        <AchievementBar pct={standing.achievementPct} />
      </div>

      {/* Per-product sales breakdown */}
      {sales && sales.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <ShoppingBag size={14} className="text-slate-500" />
            <h4 className="text-sm font-medium text-slate-700">{firstName}&apos;s Sales & Incentive Breakdown</h4>
            <span className="text-xs text-slate-400 ml-auto">{sales.length} transactions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2.5 text-left">Date</th>
                <th className="p-2.5 text-left">Product Family</th>
                <th className="p-2.5 text-left">Brand</th>
                <th className="p-2.5 text-right">Unit Price</th>
                <th className="p-2.5 text-center">Qty</th>
                <th className="p-2.5 text-right">Per-Unit Incentive</th>
                <th className="p-2.5 text-right">Total Incentive</th>
              </tr></thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2.5 text-xs text-slate-500">{s.date}</td>
                    <td className="p-2.5 font-medium">{s.productFamily}</td>
                    <td className="p-2.5">{s.brand}</td>
                    <td className="p-2.5 text-right">{formatInr(s.unitPrice)}</td>
                    <td className="p-2.5 text-center">{s.quantity}</td>
                    <td className="p-2.5 text-right">{s.incentiveEarned > 0 ? formatInr(Math.round(s.incentiveEarned / s.quantity)) : "\u2014"}</td>
                    <td className="p-2.5 text-right font-medium text-emerald-700">{s.incentiveEarned > 0 ? formatInr(s.incentiveEarned) : <span className="text-slate-400">{"\u20B9"}0</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="border-t-2 border-slate-200">
                  <td colSpan={6} className="p-2.5 text-right font-semibold text-slate-700">Total Base Incentive</td>
                  <td className="p-2.5 text-right font-bold text-emerald-700">{formatInr(sales.reduce((s, r) => s + r.incentiveEarned, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {departments && departments.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="font-medium text-slate-900 mb-3">Department Breakdown</h4>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Department</th><th className="p-2 text-right">Target</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">Achievement</th></tr></thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2 font-medium">{d.department}</td>
                  <td className="p-2 text-right">{formatInr(d.target)}</td>
                  <td className="p-2 text-right">{formatInr(d.actual)}</td>
                  <td className="p-2 text-right">{d.achievementPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-3">Multiplier Tiers</h4>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Achievement Range</th><th className="p-2 text-right">Multiplier</th><th className="p-2 text-right">{firstName}&apos;s Incentive</th></tr></thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i} className={`border-t border-slate-100 ${t.isCurrentTier ? "bg-blue-50 font-medium" : ""}`}>
                <td className="p-2">{t.from}% — {t.to >= 999 ? "or above" : `${t.to}%`}{t.isCurrentTier ? <span className="ml-2 text-xs text-blue-600 font-semibold">CURRENT</span> : null}</td>
                <td className="p-2 text-right">{t.multiplierPct}%</td>
                <td className="p-2 text-right">{formatInr(t.incentiveAtTier)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GroceryDetail({ data, firstName }: { data: Record<string, unknown>; firstName: string }) {
  const standing = data.currentStanding as { campaignName: string; storeTarget: number; storeActual: number; achievementPct: number; totalPiecesSold: number; currentRate: number; totalStorePayout: number; employeeCount: number; yourPayout: number } | null;
  const slabs = data.payoutSlabs as Array<{ from: number; to: number; rate: number; isCurrentSlab: boolean; payoutAtSlab: number }>;
  const sales = data.recentSales as Array<{ date: string; brand: string; articleCode: string; description: string; quantity: number; grossAmount: number }> | undefined;
  if (!standing) return null;

  return (
    <>
      <Row gutter={[12, 12]}>
        <Col xs={12} lg={6}><StatCard icon={<Store size={16} />} label="Campaign" value={standing.campaignName} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Achievement" value={`${standing.achievementPct}%`} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<Users size={16} />} label="Pieces sold" value={formatNumber(standing.totalPiecesSold)} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label={`${firstName}'s payout`} value={formatInr(standing.yourPayout)} valueColor="#047857" /></Col>
      </Row>

      {/* Calculation explainer */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h4 className="text-sm font-semibold text-emerald-900 mb-2">How {firstName}&apos;s incentive is calculated</h4>
        <div className="text-sm text-emerald-800 space-y-1">
          <p>1. Store must achieve <strong>100%+</strong> of campaign target to unlock incentives</p>
          <p>2. Achievement: <strong>{formatInr(standing.storeActual)} / {formatInr(standing.storeTarget)} = {standing.achievementPct}%</strong></p>
          <p>3. At this level, rate = <strong>{"\u20B9"}{standing.currentRate}/piece</strong> × {standing.totalPiecesSold} pieces = <strong>{formatInr(Math.round(standing.currentRate * standing.totalPiecesSold))} total pool</strong></p>
          <p>4. Split equally among {standing.employeeCount} employees → <strong>{firstName}&apos;s share: {formatInr(standing.yourPayout)}</strong></p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-1">Store Progress</h4>
        <p className="text-xs text-slate-500 mb-3">Target: {formatInr(standing.storeTarget)} | Actual: {formatInr(standing.storeActual)} | Rate: {"\u20B9"}{standing.currentRate}/piece | Split among {standing.employeeCount} employees</p>
        <AchievementBar pct={standing.achievementPct} />
      </div>

      {/* Sales breakdown */}
      {sales && sales.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <ShoppingBag size={14} className="text-slate-500" />
            <h4 className="text-sm font-medium text-slate-700">{firstName}&apos;s Sales</h4>
            <span className="text-xs text-slate-400 ml-auto">{sales.length} items</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2.5 text-left">Date</th>
                <th className="p-2.5 text-left">Product</th>
                <th className="p-2.5 text-left">Brand</th>
                <th className="p-2.5 text-center">Qty</th>
                <th className="p-2.5 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2.5 text-xs text-slate-500">{s.date}</td>
                    <td className="p-2.5"><p className="font-medium">{s.description || s.articleCode}</p></td>
                    <td className="p-2.5">{s.brand}</td>
                    <td className="p-2.5 text-center">{s.quantity}</td>
                    <td className="p-2.5 text-right font-medium">{formatInr(s.grossAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="border-t-2 border-slate-200">
                  <td colSpan={3} className="p-2.5 text-right font-semibold text-slate-700">Total</td>
                  <td className="p-2.5 text-center font-semibold">{sales.reduce((s, r) => s + r.quantity, 0)}</td>
                  <td className="p-2.5 text-right font-bold">{formatInr(sales.reduce((s, r) => s + r.grossAmount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-3">Payout Slabs</h4>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Achievement Range</th><th className="p-2 text-right">Rate/Piece</th><th className="p-2 text-right">{firstName}&apos;s Share</th></tr></thead>
          <tbody>
            {slabs.map((s, i) => (
              <tr key={i} className={`border-t border-slate-100 ${s.isCurrentSlab ? "bg-emerald-50 font-medium" : ""}`}>
                <td className="p-2">{s.from}% — {s.to >= 999 ? "or above" : `${s.to}%`}{s.isCurrentSlab ? <span className="ml-2 text-xs text-emerald-600 font-semibold">CURRENT</span> : null}</td>
                <td className="p-2 text-right">{"\u20B9"}{s.rate}</td>
                <td className="p-2 text-right">{formatInr(s.payoutAtSlab)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FnlDetail({ data, firstName }: { data: Record<string, unknown>; firstName: string }) {
  const standing = data.currentStanding as { weeklyTarget: number; weeklyActual: number; achievementPct: number; exceeded: boolean; storePool: number; roleSplit: { saPoolPct: number; smSharePct: number; dmSharePerDmPct: number }; eligibleSAs: number; yourAttendanceDays: number; attendanceEligible: boolean; yourPayout: number } | null;
  const whatIf = data.whatIf as { ifNotExceeded: string; ifMoreSales: string } | undefined;
  const weeks = data.weeks as Array<{ periodStart: string; periodEnd: string; payout: number; actualSales: number; targetValue: number }> | undefined;
  if (!standing) return null;

  return (
    <>
      <Row gutter={[12, 12]}>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Achievement" value={`${standing.achievementPct}%`} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label="Store pool" value={standing.exceeded ? formatInr(standing.storePool) : "₹0"} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<User size={16} />} label="Attendance" value={`${standing.yourAttendanceDays} days ${standing.attendanceEligible ? "✓" : "✗"}`} /></Col>
        <Col xs={12} lg={6}><StatCard icon={<TrendingUp size={16} />} label={`${firstName}'s payout`} value={formatInr(standing.yourPayout)} valueColor="#047857" /></Col>
      </Row>

      {/* Calculation explainer */}
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <h4 className="text-sm font-semibold text-violet-900 mb-2">How {firstName}&apos;s incentive is calculated</h4>
        <div className="text-sm text-violet-800 space-y-1">
          <p>1. Store must <strong>exceed</strong> the weekly target to create an incentive pool</p>
          <p>2. Pool = 1% of actual sales = <strong>{standing.exceeded ? formatInr(standing.storePool) : "\u20B90 (target not met)"}</strong></p>
          <p>3. Pool is split by role: SA {standing.roleSplit.saPoolPct}% · SM {standing.roleSplit.smSharePct}% · DM {standing.roleSplit.dmSharePerDmPct}%/DM</p>
          <p>4. Need <strong>min 5 PRESENT days</strong> to be eligible. {firstName} has {standing.yourAttendanceDays} → <strong>{standing.attendanceEligible ? "Eligible" : "Not eligible"}</strong></p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-1">Store Weekly Progress</h4>
        <p className="text-xs text-slate-500 mb-3">Target: {formatInr(standing.weeklyTarget)} | Actual: {formatInr(standing.weeklyActual)} | {standing.exceeded ? "Target EXCEEDED" : "Target NOT met"}</p>
        <AchievementBar pct={standing.achievementPct} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="font-medium text-slate-900 mb-3">Pool Breakdown</h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500 text-xs">SA Pool</p><p className="font-semibold">{standing.roleSplit.saPoolPct}% → {formatInr(Math.round(standing.storePool * standing.roleSplit.saPoolPct / 100))}</p><p className="text-xs text-slate-400">Split among {standing.eligibleSAs} eligible SAs</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500 text-xs">SM Share</p><p className="font-semibold">{standing.roleSplit.smSharePct}% → {formatInr(Math.round(standing.storePool * standing.roleSplit.smSharePct / 100))}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500 text-xs">DM Share/DM</p><p className="font-semibold">{standing.roleSplit.dmSharePerDmPct}% → {formatInr(Math.round(standing.storePool * standing.roleSplit.dmSharePerDmPct / 100))}</p></div>
        </div>
      </div>
      {whatIf && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="font-medium text-slate-900 mb-2">What If</h4>
          <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
            <li>{whatIf.ifNotExceeded}</li>
            <li>{whatIf.ifMoreSales}</li>
          </ul>
        </div>
      )}
      {weeks && weeks.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="font-medium text-slate-900 mb-3">Weekly History</h4>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Week</th><th className="p-2 text-right">Target</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">{firstName}&apos;s Payout</th></tr></thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2">{w.periodStart} — {w.periodEnd}</td>
                  <td className="p-2 text-right">{formatInr(w.targetValue)}</td>
                  <td className="p-2 text-right">{formatInr(w.actualSales)}</td>
                  <td className="p-2 text-right font-medium">{formatInr(w.payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
