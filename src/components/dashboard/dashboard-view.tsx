"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Area, CartesianGrid, Line, ComposedChart,
} from "recharts";
import { Vertical } from "@/lib/constants";
import { formatInr, formatNumber } from "@/lib/format";
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
  achievementDistribution: Array<{ bucket: string; count: number }>;
  dailySalesTrend: Array<{ date: string; label: string; sales: number; transactions: number; targetPace: number }>;
  topPerformers: Array<{
    rank: number;
    employeeName: string;
    role: string;
    storeCode: string;
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

type Tab = "drilldown" | "overview";

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
  sales: "Total gross sales across all stores for the selected month and vertical.",
  incentive: "Total incentive earned by all employees this month, after multiplier/slab application.",
  upside: "Additional incentive that would be earned if every store reaches 100% achievement. This is money being left on the table.",
  achievement: "Average achievement percentage across all stores. Company benchmark is 90%.",
  plans: "Number of incentive plans currently in ACTIVE status for the selected vertical.",
};

function AchievementBadge({ pct }: { pct: number }) {
  const label = pct >= 100 ? "On track" : pct >= 90 ? "Near target" : pct >= 85 ? "Below target" : "Critical";
  const color = pct >= 100 ? "success" : pct >= 85 ? "warning" : "error";
  return <Tag color={color} style={{ marginInlineStart: 4, fontSize: 10 }}>{label}</Tag>;
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
          <Popover content={<Typography.Text style={{ maxWidth: 280, fontSize: 12 }}>{kpiTooltips[tooltipKey]}</Typography.Text>} trigger="click">
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
      {subtitle && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
          {subtitle}
        </Typography.Text>
      )}
    </Card>
  );
}

export function DashboardView() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selected, setSelected] = useState<"ALL" | Vertical>("ALL");
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("drilldown");
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);

  const drilldownRef = useRef<{ drillToStore: (storeCode: string, storeName: string) => void } | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selected !== "ALL") params.set("vertical", selected);
    params.set("month", month);
    fetch(`/api/dashboard?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: DashboardResponse) => setData(payload))
      .catch((err) => console.error("Dashboard fetch failed:", err))
      .finally(() => setLoading(false));
  }, [selected, month]);

  const unlockable = useMemo(() => {
    if (!data) return 0;
    return data.stats.potentialIncentive - data.stats.totalIncentiveMtd;
  }, [data]);

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
      dataIndex: "rank",
      width: 72,
      render: (rank: number) => (
        <Tag color={rank <= 3 ? "gold" : "default"} style={{ width: 28, textAlign: "center", margin: 0 }}>
          {rank}
        </Tag>
      ),
    },
    { title: "Name", dataIndex: "employeeName" },
    { title: "Role", dataIndex: "role" },
    { title: "Store", dataIndex: "storeCode" },
    {
      title: "Incentive",
      dataIndex: "incentive",
      align: "right",
      render: (v: number) => <Typography.Text strong style={{ color: "#059669" }}>{formatInr(v)}</Typography.Text>,
    },
  ];

  if (loading && !data) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: 320 }}>
        <Space direction="vertical" align="center">
          <Spin size="large" />
          <Typography.Text type="secondary">Loading dashboard…</Typography.Text>
        </Space>
      </Flex>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
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
            </Typography.Text>
          )}
        </Flex>
      </Flex>

      {data && (
        <>
          {overviewCollapsed ? (
            <Button block type="default" onClick={() => setOverviewCollapsed(false)} style={{ textAlign: "left", height: "auto", paddingBlock: 12 }}>
              <Flex justify="space-between" align="center" gap={8}>
                <span>
                  {data.monthLabel} · {formatInr(data.stats.totalSalesMtd)} Sales · {formatInr(data.stats.totalIncentiveMtd)} Earned · {data.stats.avgAchievementPct}% Avg Achievement
                </span>
                <ChevronDown size={16} />
              </Flex>
            </Button>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Row gutter={[12, 12]}>
                <Col xs={24} sm={12} lg={8} xl={5}>
                  <KpiCard
                    icon={<ShoppingCart size={18} />}
                    iconBg="bg-blue-100 text-blue-600"
                    label="Total Sales MTD"
                    value={formatInr(data.stats.totalSalesMtd)}
                    subtitle={`Target: ${formatInr(data.stats.totalTarget)}`}
                    tooltipKey="sales"
                  />
                </Col>
                <Col xs={24} sm={12} lg={8} xl={5}>
                  <KpiCard
                    icon={<IndianRupee size={18} />}
                    iconBg="bg-emerald-100 text-emerald-600"
                    label="Incentives Earned"
                    value={formatInr(data.stats.totalIncentiveMtd)}
                    subtitle={`of ${formatInr(data.stats.potentialIncentive)} potential`}
                    valueStyle={{ color: "#047857" }}
                    tooltipKey="incentive"
                  />
                </Col>
                <Col xs={24} sm={12} lg={8} xl={5}>
                  <KpiCard
                    icon={<Award size={18} />}
                    iconBg="bg-amber-100 text-amber-600"
                    label="Incentive Upside"
                    value={formatInr(unlockable)}
                    subtitle="gap to full payout"
                    valueStyle={{ color: "#b45309" }}
                    tooltipKey="upside"
                  />
                </Col>
                <Col xs={24} sm={12} lg={8} xl={5}>
                  <KpiCard
                    icon={<Target size={18} />}
                    iconBg="bg-indigo-100 text-indigo-600"
                    label="Avg Achievement"
                    value={`${data.stats.avgAchievementPct}%`}
                    trend={data.stats.avgAchievementPct >= 100}
                    badge={<AchievementBadge pct={data.stats.avgAchievementPct} />}
                    tooltipKey="achievement"
                  />
                </Col>
                <Col xs={24} sm={12} lg={8} xl={4}>
                  <KpiCard
                    icon={<Store size={18} />}
                    iconBg="bg-slate-100 text-slate-600"
                    label="Active Incentive Plans"
                    value={formatNumber(data.stats.activeSchemes)}
                    subtitle={`${formatNumber(data.stats.stores)} stores, ${formatNumber(data.stats.totalEmployees)} associates`}
                    tooltipKey="plans"
                  />
                </Col>
              </Row>

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
                    />
                  )}
                  {data.alerts.belowThresholdStores > 0 && (
                    <Alert
                      type="error"
                      showIcon
                      icon={<AlertTriangle size={16} />}
                      message={`${data.alerts.belowThresholdStores} store${data.alerts.belowThresholdStores > 1 ? "s" : ""} below gate threshold`}
                      description={
                        data.alerts.belowThresholdList.length > 0 ? (
                          <Space wrap size={[8, 8]} style={{ marginTop: 8 }}>
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
                        ) : null
                      }
                    />
                  )}
                </Space>
              )}

              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card title="Store Achievement Distribution" size="small" styles={{ header: { minHeight: 48 } }}>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
                      Number of stores per achievement band
                    </Typography.Paragraph>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data.achievementDistribution} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                          formatter={(value) => [String(value), "Stores"]}
                        />
                        <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title="Daily Sales Trend" size="small" styles={{ header: { minHeight: 48 } }}>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
                      Actual sales vs target pace
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
                          formatter={(value, name) => [formatInr(Number(value)), name === "sales" ? "Actual Sales" : "Target Pace"]}
                          labelFormatter={(label) => String(label)}
                        />
                        <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGrad)" />
                        <Line type="monotone" dataKey="targetPace" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
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
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Incentive Earned</Typography.Text>
                            <div><Typography.Text strong style={{ color: "#047857" }}>{formatInr(v.incentiveEarned)}</Typography.Text></div>
                          </Col>
                          <Col span={12}>
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Avg Achievement</Typography.Text>
                            <div>
                              <Typography.Text>{v.avgAchievementPct}%</Typography.Text>
                              <AchievementBadge pct={v.avgAchievementPct} />
                            </div>
                          </Col>
                          <Col span={12}>
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Stores / Associates</Typography.Text>
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
                label: "Store & Employee Breakdown",
                children: (
                  <IncentiveDrilldown ref={drilldownRef} vertical={selected === "ALL" ? "" : selected} month={month} />
                ),
              },
              {
                key: "overview",
                label: "Top Performers",
                children: (
                  <Card title="Top 10 Performers" size="small" styles={{ body: { paddingTop: 12 } }}>
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
  );
}
