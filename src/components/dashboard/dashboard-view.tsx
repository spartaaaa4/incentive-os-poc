"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Popover,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Area, CartesianGrid, Legend, Line, ComposedChart,
} from "recharts";
import { Vertical } from "@/lib/constants";
import { formatInr, formatNumber, formatInrScaleHint, pctDelta } from "@/lib/format";
import { IncentiveDrilldown } from "@/components/dashboard/incentive-drilldown";
import {
  TrendingUp, TrendingDown, IndianRupee, ShoppingCart,
  Award, Target, Store, AlertTriangle, ChevronRight,
  ChevronLeft, Info, ChevronDown, ChevronUp, Clock,
  Users,
} from "lucide-react";

type VerticalBreakdown = {
  vertical: string;
  stores: number;
  employees: number;
  salesMtd: number;
  incentiveEarned: number;
  avgAchievementPct: number;
};

type DashboardResponse = {
  month: string;
  monthLabel: string;
  lastCalculatedAt: string | null;
  stats: {
    totalEmployees: number;
    employeesEarning: number;
    totalSalesMtd: number;
    totalTarget: number;
    totalIncentiveMtd: number;
    potentialIncentive: number;
    avgAchievementPct: number;
    activeSchemes: number;
    stores: number;
  };
  alerts: {
    pendingApprovals: number;
    belowThresholdStores: number;
    belowThresholdList: Array<{ storeCode: string; storeName: string; achievementPct: number }>;
  };
  verticalBreakdown: VerticalBreakdown[];
  achievementDistribution: Array<{ bucket: string; count: number; stores?: Array<{ storeCode: string; storeName: string; vertical: string; sales: number; target: number; achievementPct: number }> }>;
  dailySalesTrend: Array<{ date: string; label: string; sales: number; transactions: number; targetPace: number }>;
  topPerformers: Array<{
    rank: number;
    employeeName: string;
    role: string;
    storeCode: string;
    storeName: string;
    incentive: number;
  }>;
};

const verticalLabels: Record<string, string> = {
  ELECTRONICS: "Electronics",
  GROCERY: "Grocery",
  FNL: "Fashion & Lifestyle",
};

const verticalDotColor: Record<string, string> = {
  ELECTRONICS: "#2563eb",
  GROCERY: "#059669",
  FNL: "#7c3aed",
};

const filterOptions: Array<{ label: string; value: "ALL" | Vertical }> = [
  { label: "All Verticals", value: "ALL" },
  { label: "Electronics", value: Vertical.ELECTRONICS },
  { label: "Grocery", value: Vertical.GROCERY },
  { label: "F&L", value: Vertical.FNL },
];

type Tab = "performers" | "drilldown";

function prevMonthKey(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthOptions() {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let offset = -6; offset <= 6; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const kpiTooltips: Record<string, string> = {
  sales: "Gross sales summed across all stores in scope for the calendar month you selected (offline normal transactions in this POC).",
  incentive: "Total incentive credited to employees for this month after slabs and multipliers. This is actual payout, not accrual.",
  upside: "Extra incentive that could still be earned if every store reached 100% of target (same scheme rules). It is the gap between potential and earned.",
  achievement: "Simple average of each store’s achievement % (sales vs target) in scope. Internal benchmark 90% is shown as a guide, not a hard rule in this demo.",
  plans: "Incentive plans in ACTIVE status for the selected vertical. Each vertical can run multiple schemes.",
};

function AchievementBadge({ pct }: { pct: number }) {
  const label = pct >= 100 ? "On track" : pct >= 90 ? "Near target" : pct >= 85 ? "Below target" : "Critical";
  const color = pct >= 100 ? "success" : pct >= 85 ? "warning" : "error";
  return <Tag color={color} style={{ marginInlineStart: 4, fontSize: 10 }}>{label}</Tag>;
}

function DeltaTag({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const up = delta >= 0;
  return (
    <Tag color={up ? "green" : "red"} style={{ marginTop: 4, fontSize: 11 }}>
      {up ? <TrendingUp size={10} style={{ marginRight: 4 }} /> : <TrendingDown size={10} style={{ marginRight: 4 }} />}
      vs prev. month: {up ? "+" : ""}{delta}%
    </Tag>
  );
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  subtitle,
  valueStyle,
  trend,
  badge,
  tooltipKey,
  scaleHint,
  deltaPct,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  subtitle?: string;
  valueStyle?: React.CSSProperties;
  trend?: boolean;
  badge?: React.ReactNode;
  tooltipKey?: string;
  scaleHint?: string | null;
  deltaPct?: number | null;
}) {
  return (
    <Card styles={{ body: { padding: 16 } }} style={{ height: "100%" }}>
      <Flex align="flex-start" gap={10} style={{ marginBottom: 8 }}>
        <div style={{ borderRadius: 8, padding: 6, background: iconBg.includes("blue") ? "#dbeafe" : iconBg.includes("emerald") ? "#d1fae5" : iconBg.includes("amber") ? "#fef3c7" : iconBg.includes("indigo") ? "#e0e7ff" : "#f1f5f9", color: iconBg.includes("blue") ? "#2563eb" : iconBg.includes("emerald") ? "#059669" : iconBg.includes("amber") ? "#d97706" : iconBg.includes("indigo") ? "#4f46e5" : "#64748b" }}>
          {icon}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", flex: 1, lineHeight: 1.3 }}>
          {label}
        </Typography.Text>
        {tooltipKey && (
          <Popover content={<Typography.Text style={{ maxWidth: 300, fontSize: 12 }}>{kpiTooltips[tooltipKey]}</Typography.Text>} trigger="click">
            <Button type="text" size="small" icon={<Info size={13} />} style={{ color: "#94a3b8" }} aria-label="Metric info" />
          </Popover>
        )}
      </Flex>
      <Flex align="flex-end" gap={8} wrap="wrap">
        <Statistic value={value} valueStyle={{ fontSize: 22, fontWeight: 700, ...valueStyle }} />
        {trend !== undefined && (
          <span style={{ color: trend ? "#059669" : "#ef4444", display: "flex", alignItems: "center", marginBottom: 4 }}>
            {trend ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          </span>
        )}
        {badge}
      </Flex>
      {scaleHint ? (
        <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 2 }}>
          ≈ {scaleHint} (Indian numbering)
        </Typography.Text>
      ) : null}
      {subtitle && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
          {subtitle}
        </Typography.Text>
      )}
      <DeltaTag delta={deltaPct ?? null} />
    </Card>
  );
}

export function DashboardView() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selected, setSelected] = useState<"ALL" | Vertical>("ALL");
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [prevStats, setPrevStats] = useState<{ totalSalesMtd: number; totalIncentiveMtd: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("drilldown");
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const [selectedBand, setSelectedBand] = useState<string | null>(null);

  const drilldownRef = useRef<{ drillToStore: (storeCode: string, storeName: string) => void } | null>(null);

  const [attendance, setAttendance] = useState<{ isConnected: boolean; latestUploadAt: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/attendance/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!payload) return;
        setAttendance({
          isConnected: !!payload.isConnected,
          latestUploadAt: payload.latestUpload?.uploadedAt ?? null,
        });
      })
      .catch(() => {});
  }, []);

  const handleEnterCityStores = useCallback(() => {
    setOverviewCollapsed(true);
  }, []);

  const handleReturnDrilldownRoot = useCallback(() => {
    setOverviewCollapsed(false);
  }, []);

  useEffect(() => {
    setOverviewCollapsed(false);
  }, [selected, month]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selected !== "ALL") params.set("vertical", selected);
    params.set("month", month);
    const prevKey = prevMonthKey(month);
    const prevParams = new URLSearchParams(params);
    prevParams.set("month", prevKey);

    const load = async () => {
      try {
        const [res, resPrev] = await Promise.all([
          fetch(`/api/dashboard?${params.toString()}`),
          fetch(`/api/dashboard?${prevParams.toString()}`),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as DashboardResponse;
        setData(payload);
        if (resPrev.ok) {
          const p = (await resPrev.json()) as DashboardResponse;
          setPrevStats({ totalSalesMtd: p.stats.totalSalesMtd, totalIncentiveMtd: p.stats.totalIncentiveMtd });
        } else {
          setPrevStats(null);
        }
      } catch (err) {
        console.error("Dashboard fetch failed:", err);
        setData(null);
        setPrevStats(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [selected, month]);

  const unlockable = useMemo(() => {
    if (!data) return 0;
    return data.stats.potentialIncentive - data.stats.totalIncentiveMtd;
  }, [data]);

  const salesDelta = useMemo(
    () => (data && prevStats ? pctDelta(data.stats.totalSalesMtd, prevStats.totalSalesMtd) : null),
    [data, prevStats],
  );
  const incentiveDelta = useMemo(
    () => (data && prevStats ? pctDelta(data.stats.totalIncentiveMtd, prevStats.totalIncentiveMtd) : null),
    [data, prevStats],
  );

  const handleBelowThresholdClick = (storeCode: string, storeName: string) => {
    setTab("drilldown");
    setOverviewCollapsed(true);
    setTimeout(() => {
      drilldownRef.current?.drillToStore(storeCode, storeName);
    }, 100);
  };

  const performerColumns: ColumnsType<DashboardResponse["topPerformers"][number]> = [
    {
      title: "Rank",
      key: "rank",
      dataIndex: "rank",
      width: 72,
      render: (rank: number) => (
        <Tag color={rank <= 3 ? "gold" : "default"} style={{ width: 28, textAlign: "center", margin: 0 }}>
          {rank}
        </Tag>
      ),
    },
    { title: "Name", key: "employeeName", dataIndex: "employeeName" },
    { title: "Role", key: "role", dataIndex: "role" },
    {
      title: "Store",
      key: "store",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ fontSize: 13 }}>{row.storeName}</Typography.Text>
          <Typography.Text type="secondary" code style={{ fontSize: 11 }}>{row.storeCode}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "Incentive",
      key: "incentive",
      dataIndex: "incentive",
      align: "right",
      render: (v: number) => <Typography.Text strong style={{ color: "#059669" }}>{formatInr(v)}</Typography.Text>,
    },
  ];

  if (!data && !loading) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: 320 }}>
        <Typography.Text type="danger">Could not load dashboard.</Typography.Text>
      </Flex>
    );
  }

  return (
    <Spin spinning={loading} tip={data ? "Refreshing…" : "Loading dashboard…"} size="large">
      <Space direction="vertical" size="large" style={{ width: "100%", minHeight: 120 }}>
          <Flex wrap="wrap" align="center" justify="space-between" gap={16}>
            <Segmented
              options={filterOptions.map((o) => ({ label: o.label, value: o.value }))}
              value={selected}
              onChange={(v) => setSelected(v as "ALL" | Vertical)}
            />
            <Flex wrap="wrap" align="center" gap={12}>
              <Space.Compact>
                <Button
                  type="default"
                  icon={<ChevronLeft size={16} />}
                  disabled={month === monthOptions[0]?.value}
                  onClick={() => {
                    const idx = monthOptions.findIndex((m) => m.value === month);
                    if (idx > 0) setMonth(monthOptions[idx - 1].value);
                  }}
                />
                <Select
                  style={{ minWidth: 160 }}
                  value={month}
                  onChange={setMonth}
                  options={monthOptions.map((m) => ({ value: m.value, label: m.label }))}
                />
                <Button
                  type="default"
                  icon={<ChevronRight size={16} />}
                  disabled={month === monthOptions[monthOptions.length - 1]?.value}
                  onClick={() => {
                    const idx = monthOptions.findIndex((m) => m.value === month);
                    if (idx < monthOptions.length - 1) setMonth(monthOptions[idx + 1].value);
                  }}
                />
              </Space.Compact>
              {data?.lastCalculatedAt && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <Clock size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  Last updated:{" "}
                  {new Date(data.lastCalculatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  , {new Date(data.lastCalculatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  {loading && data ? " · refreshing…" : ""}
                </Typography.Text>
              )}
            </Flex>
          </Flex>

          {(selected === "ALL" || selected === Vertical.FNL) && attendance && !attendance.isConnected ? (
            <Alert
              type="warning"
              showIcon
              message="Attendance data not connected"
              description={
                attendance.latestUploadAt
                  ? `F&L weekly pool incentives depend on attendance. Last upload was on ${new Date(attendance.latestUploadAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}. Upload current-period attendance to resume F&L calculation.`
                  : "F&L weekly pool incentives cannot be calculated until attendance is uploaded."
              }
              action={
                <Link href="/attendance">
                  <Button size="small" type="primary">Upload attendance</Button>
                </Link>
              }
            />
          ) : null}

          {data && (
            <>
              {overviewCollapsed ? (
                <Button block type="default" onClick={() => setOverviewCollapsed(false)} style={{ textAlign: "left", height: "auto", paddingBlock: 12 }}>
                  <Flex vertical gap={6} style={{ width: "100%" }}>
                    <Flex justify="space-between" align="center" gap={8}>
                      <Typography.Text strong>{data.monthLabel}</Typography.Text>
                      <ChevronDown size={16} />
                    </Flex>
                    <Flex wrap="wrap" gap="small">
                      <Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Sales </Typography.Text>
                        <Typography.Text strong>{formatInr(data.stats.totalSalesMtd)}</Typography.Text>
                      </Tag>
                      <Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Incentive </Typography.Text>
                        <Typography.Text strong style={{ color: "#047857" }}>{formatInr(data.stats.totalIncentiveMtd)}</Typography.Text>
                      </Tag>
                      <Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Avg achievement </Typography.Text>
                        <Typography.Text strong>{data.stats.avgAchievementPct}%</Typography.Text>
                      </Tag>
                      <Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Stores </Typography.Text>
                        <Typography.Text strong>{formatNumber(data.stats.stores)}</Typography.Text>
                      </Tag>
                    </Flex>
                  </Flex>
                </Button>
              ) : (
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12} lg={8} xl={5}>
                      <KpiCard
                        icon={<ShoppingCart size={18} />}
                        iconBg="bg-blue-100 text-blue-600"
                        label="Sales (this month)"
                        value={formatInr(data.stats.totalSalesMtd)}
                        subtitle={`Target for month: ${formatInr(data.stats.totalTarget)} · MTD = month-to-date`}
                        scaleHint={formatInrScaleHint(data.stats.totalSalesMtd)}
                        tooltipKey="sales"
                        deltaPct={salesDelta}
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={5}>
                      <KpiCard
                        icon={<IndianRupee size={18} />}
                        iconBg="bg-emerald-100 text-emerald-600"
                        label="Incentives paid (earned)"
                        value={formatInr(data.stats.totalIncentiveMtd)}
                        subtitle={`of ${formatInr(data.stats.potentialIncentive)} if all stores hit 100% of target`}
                        valueStyle={{ color: "#047857" }}
                        scaleHint={formatInrScaleHint(data.stats.totalIncentiveMtd)}
                        tooltipKey="incentive"
                        deltaPct={incentiveDelta}
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={5}>
                      <KpiCard
                        icon={<Award size={18} />}
                        iconBg="bg-amber-100 text-amber-600"
                        label="Remaining incentive upside"
                        value={formatInr(unlockable)}
                        subtitle="Extra payout still available at full target achievement"
                        valueStyle={{ color: "#b45309" }}
                        scaleHint={formatInrScaleHint(unlockable)}
                        tooltipKey="upside"
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={5}>
                      <KpiCard
                        icon={<Target size={18} />}
                        iconBg="bg-indigo-100 text-indigo-600"
                        label="Average store achievement"
                        value={`${data.stats.avgAchievementPct}%`}
                        trend={data.stats.avgAchievementPct >= 100}
                        badge={<AchievementBadge pct={data.stats.avgAchievementPct} />}
                        subtitle="Mean of each store’s sales vs target % in scope"
                        tooltipKey="achievement"
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <KpiCard
                        icon={<Store size={18} />}
                        iconBg="bg-slate-100 text-slate-600"
                        label="Active incentive plans"
                        value={formatNumber(data.stats.activeSchemes)}
                        subtitle={`${formatNumber(data.stats.stores)} stores · ${formatNumber(data.stats.totalEmployees)} associates`}
                        tooltipKey="plans"
                      />
                    </Col>
                  </Row>

                  {/* Target vs Achieved card */}
                  <Card size="small" styles={{ body: { padding: 16 } }}>
                    <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 10 }}>
                      <div style={{ borderRadius: 8, padding: 6, background: "#e0e7ff", color: "#4f46e5" }}>
                        <Target size={18} />
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase" }}>
                        Target vs Achieved (MTD)
                      </Typography.Text>
                    </Flex>
                    <Row gutter={[24, 16]} align="middle">
                      <Col xs={24} sm={8}>
                        <Statistic
                          title="Monthly target"
                          value={data.stats.totalTarget}
                          formatter={(v) => formatInr(Number(v))}
                          valueStyle={{ fontSize: 20, fontWeight: 700, color: "#64748b" }}
                        />
                      </Col>
                      <Col xs={24} sm={8}>
                        <Statistic
                          title="Actual sales (MTD)"
                          value={data.stats.totalSalesMtd}
                          formatter={(v) => formatInr(Number(v))}
                          valueStyle={{ fontSize: 20, fontWeight: 700, color: data.stats.totalSalesMtd >= data.stats.totalTarget ? "#047857" : "#b45309" }}
                        />
                      </Col>
                      <Col xs={24} sm={8}>
                        <Flex vertical gap={4}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Achievement: <Typography.Text strong style={{ color: data.stats.avgAchievementPct >= 100 ? "#047857" : "#b45309" }}>
                              {data.stats.totalTarget > 0 ? Math.round((data.stats.totalSalesMtd / data.stats.totalTarget) * 100) : 0}%
                            </Typography.Text>
                          </Typography.Text>
                          <Progress
                            percent={data.stats.totalTarget > 0 ? Math.min(100, Math.round((data.stats.totalSalesMtd / data.stats.totalTarget) * 100)) : 0}
                            strokeColor={data.stats.totalSalesMtd >= data.stats.totalTarget ? "#10b981" : "#f59e0b"}
                            showInfo={false}
                          />
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            {data.stats.totalSalesMtd >= data.stats.totalTarget
                              ? `Exceeded target by ${formatInr(data.stats.totalSalesMtd - data.stats.totalTarget)}`
                              : `${formatInr(data.stats.totalTarget - data.stats.totalSalesMtd)} remaining to hit target`}
                          </Typography.Text>
                        </Flex>
                      </Col>
                    </Row>
                  </Card>

                  <Card size="small">
                    <Flex align="center" gap={12} wrap="wrap">
                      <Users size={14} style={{ color: "#94a3b8" }} />
                      <Typography.Text>
                        <Typography.Text strong style={{ color: "#047857" }}>{formatNumber(data.stats.employeesEarning)}</Typography.Text>
                        {" "}of{" "}
                        <Typography.Text strong>{formatNumber(data.stats.totalEmployees)}</Typography.Text>
                        {" "}associates earning incentives this month
                      </Typography.Text>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <Progress
                          percent={data.stats.totalEmployees > 0 ? Math.round((data.stats.employeesEarning / data.stats.totalEmployees) * 100) : 0}
                          strokeColor="#10b981"
                          showInfo
                        />
                      </div>
                    </Flex>
                  </Card>

                  {(data.alerts.pendingApprovals > 0 || data.alerts.belowThresholdStores > 0) && (
                    <Space direction="vertical" size="small" style={{ width: "100%" }}>
                      {data.alerts.pendingApprovals > 0 && (
                        <Alert
                          type="warning"
                          showIcon
                          icon={<AlertTriangle size={16} />}
                          message={`${data.alerts.pendingApprovals} pending approval${data.alerts.pendingApprovals > 1 ? "s" : ""}`}
                          description={
                            <Link href="/approvals" style={{ marginTop: 8, display: "inline-block" }}>
                              Open approvals queue →
                            </Link>
                          }
                        />
                      )}
                      {data.alerts.belowThresholdStores > 0 && (
                        <Alert
                          type="error"
                          showIcon
                          icon={<AlertTriangle size={16} />}
                          message={`${data.alerts.belowThresholdStores} store${data.alerts.belowThresholdStores > 1 ? "s" : ""} below minimum achievement for incentive`}
                          description={
                            <Space direction="vertical" size="small" style={{ width: "100%", marginTop: 4 }}>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                These stores have sales but no credited incentive yet (often below scheme gate). Click a store to open its breakdown.
                              </Typography.Text>
                              {data.alerts.belowThresholdList.length > 0 ? (
                                <Space wrap size={[8, 8]}>
                                  {data.alerts.belowThresholdList.map((s) => (
                                    <Button
                                      key={s.storeCode}
                                      size="small"
                                      type="default"
                                      danger
                                      onClick={() => handleBelowThresholdClick(s.storeCode, s.storeName)}
                                    >
                                      {s.storeName} ({s.achievementPct}%) <ChevronRight size={10} style={{ display: "inline" }} />
                                    </Button>
                                  ))}
                                </Space>
                              ) : null}
                            </Space>
                          }
                        />
                      )}
                    </Space>
                  )}

                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Card title="Stores by achievement band" size="small" styles={{ header: { minHeight: 48 } }} extra={selectedBand && <Button type="link" size="small" onClick={() => setSelectedBand(null)}>Close drill-down</Button>}>
                        <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
                          Count of stores in each sales-vs-target band for the selected month. <strong>Click a bar</strong> to see stores in that band.
                        </Typography.Paragraph>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart
                            data={data.achievementDistribution}
                            margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                            onClick={(state) => {
                              if (state?.activeLabel) setSelectedBand(String(state.activeLabel) === selectedBand ? null : String(state.activeLabel));
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                              formatter={(value) => [String(value), "Stores"]}
                            />
                            <Bar
                              dataKey="count"
                              radius={[4, 4, 0, 0]}
                              cursor="pointer"
                            >
                              {data.achievementDistribution.map((entry) => (
                                <Cell key={entry.bucket} fill={entry.bucket === selectedBand ? "#4338ca" : "#6366f1"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                        {selectedBand && (() => {
                          const band = data.achievementDistribution.find((b) => b.bucket === selectedBand);
                          const stores = band?.stores ?? [];
                          return (
                            <div style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                              <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
                                <Typography.Text strong>
                                  {stores.length} store{stores.length !== 1 ? "s" : ""} in {selectedBand} band
                                </Typography.Text>
                                <Button type="text" size="small" icon={<ChevronUp size={14} />} onClick={() => setSelectedBand(null)}>Close</Button>
                              </Flex>
                              {stores.length === 0 ? (
                                <Typography.Text type="secondary">No stores in this band.</Typography.Text>
                              ) : (
                                <Table
                                  rowKey="storeCode"
                                  size="small"
                                  pagination={false}
                                  scroll={{ x: "max-content" }}
                                  dataSource={stores}
                                  columns={[
                                    { title: "Store", key: "store", render: (_: unknown, r: { storeName: string; storeCode: string; vertical: string; sales: number; target: number; achievementPct: number }) => <><Typography.Text strong>{r.storeName}</Typography.Text><br /><Typography.Text type="secondary" code style={{ fontSize: 11 }}>{r.storeCode}</Typography.Text></> },
                                    { title: "Vertical", dataIndex: "vertical", width: 100 },
                                    { title: "Actual Sales", dataIndex: "sales", align: "right" as const, render: (v: number) => formatInr(v) },
                                    { title: "Target", dataIndex: "target", align: "right" as const, render: (v: number) => formatInr(v) },
                                    { title: "Achievement", dataIndex: "achievementPct", align: "center" as const, render: (pct: number) => <Flex align="center" gap={6} justify="center"><Progress percent={Math.min(100, Math.round((pct / 150) * 100))} showInfo={false} strokeColor={pct >= 100 ? "#10b981" : pct >= 85 ? "#f59e0b" : "#ef4444"} trailColor="#f1f5f9" size="small" style={{ width: 60, marginBottom: 0 }} /><Typography.Text>{pct}%</Typography.Text></Flex> },
                                  ]}
                                />
                              )}
                            </div>
                          );
                        })()}
                      </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Card title="Daily sales vs target pace" size="small" styles={{ header: { minHeight: 48 } }}>
                        <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
                          Cumulative sales (area) compared with linear target pace (dashed line). Hover for exact rupee values.
                        </Typography.Paragraph>
                        <ResponsiveContainer width="100%" height={220}>
                          <ComposedChart data={data.dailySalesTrend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                            <defs>
                              <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}K`)} />
                            <Tooltip
                              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                              formatter={(value, name) => [formatInr(Number(value)), name === "sales" ? "Actual sales" : "Target pace (cumulative)"]}
                              labelFormatter={(label) => String(label)}
                            />
                            <Legend
                              verticalAlign="top"
                              align="right"
                              wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                              formatter={(value: string) => <span style={{ color: "#64748b" }}>{value}</span>}
                            />
                            <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGrad)" name="Actual Sales" />
                            <Line type="monotone" dataKey="targetPace" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Target Pace (Cumulative)" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Card>
                    </Col>
                  </Row>

                  {selected === "ALL" && data.verticalBreakdown.length > 0 && (
                    <Row gutter={[12, 12]}>
                      {data.verticalBreakdown.map((v) => (
                        <Col xs={24} md={8} key={v.vertical}>
                          <Card
                            hoverable
                            onClick={() => setSelected(v.vertical as Vertical)}
                            styles={{ body: { padding: 16 } }}
                          >
                            <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
                              <Space>
                                <span style={{ width: 10, height: 10, borderRadius: 999, background: verticalDotColor[v.vertical] ?? "#94a3b8", display: "inline-block" }} />
                                <Typography.Text strong>{verticalLabels[v.vertical] ?? v.vertical}</Typography.Text>
                              </Space>
                              <ChevronRight size={14} style={{ color: "#cbd5e1" }} />
                            </Flex>
                            <Row gutter={[8, 8]}>
                              <Col span={12}>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Sales</Typography.Text>
                                <div><Typography.Text strong>{formatInr(v.salesMtd)}</Typography.Text></div>
                              </Col>
                              <Col span={12}>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Incentive earned</Typography.Text>
                                <div><Typography.Text strong style={{ color: "#047857" }}>{formatInr(v.incentiveEarned)}</Typography.Text></div>
                              </Col>
                              <Col span={12}>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Avg achievement</Typography.Text>
                                <div>
                                  <Typography.Text>{v.avgAchievementPct}%</Typography.Text>
                                  <AchievementBadge pct={v.avgAchievementPct} />
                                </div>
                              </Col>
                              <Col span={12}>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Stores / associates</Typography.Text>
                                <div><Typography.Text>{v.stores} / {v.employees}</Typography.Text></div>
                              </Col>
                            </Row>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  )}

                  <Flex justify="center">
                    <Button type="link" size="small" onClick={() => setOverviewCollapsed(true)} icon={<ChevronUp size={14} />}>
                      Collapse overview
                    </Button>
                  </Flex>
                </Space>
              )}

              <Tabs
                activeKey={tab}
                onChange={(k) => setTab(k as Tab)}
                items={[
                  {
                    key: "drilldown",
                    label: "City & Store",
                    children: (
                      <IncentiveDrilldown
                        ref={drilldownRef}
                        vertical={selected === "ALL" ? "" : selected}
                        month={month}
                        onEnterCityStores={handleEnterCityStores}
                        onReturnToDrilldownRoot={handleReturnDrilldownRoot}
                      />
                    ),
                  },
                  {
                    key: "performers",
                    label: "Top performers",
                    children: (
                      <Card title="Top 10 by incentive (this month)" size="small" styles={{ body: { paddingTop: 12 } }}>
                        <Table<DashboardResponse["topPerformers"][number]>
                          rowKey={(r) => `${r.rank}-${r.employeeName}`}
                          columns={performerColumns}
                          dataSource={data.topPerformers ?? []}
                          pagination={false}
                          size="small"
                        />
                      </Card>
                    ),
                  },
                ]}
              />
            </>
          )}
      </Space>
    </Spin>
  );
}
