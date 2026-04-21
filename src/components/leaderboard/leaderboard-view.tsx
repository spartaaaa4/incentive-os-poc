"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format, subMonths, startOfMonth } from "date-fns";
import { Trophy, MapPin, Calendar, ChevronRight, Filter } from "lucide-react";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Flex,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { formatInr } from "@/lib/format";

type StoreInfo = {
  storeCode: string;
  storeName: string;
  vertical: string;
  city: string;
  storeFormat: string;
  state: string;
  storeStatus: string;
};

type LeaderboardPeriod = {
  month: string;
  startDate: string;
  endDate: string;
  label: string;
};

type StoreLeaderboardRow = {
  rank: number;
  storeCode: string;
  storeName: string;
  city: string;
  target: number;
  actual: number;
  achievementPct: number;
  isViewerStore: boolean;
};

type StoreLeaderboardResponse = {
  metric: "STORE_TARGET_ACHIEVEMENT";
  rankBy: "achievementPct";
  scope: "stores";
  vertical: string;
  city: string;
  period: LeaderboardPeriod;
  leaderboard: StoreLeaderboardRow[];
};

const verticalLabels: Record<string, string> = {
  ELECTRONICS: "Electronics",
  GROCERY: "Grocery",
  FNL: "Fashion & Lifestyle",
};

const verticalTagColor: Record<string, string> = {
  ELECTRONICS: "blue",
  GROCERY: "green",
  FNL: "purple",
};

function rollingMonthOptions(count: number): { value: string; label: string }[] {
  const base = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = subMonths(startOfMonth(base), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
  });
}

function RankBadge({ rank }: { rank: number }) {
  const common = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    width: 28,
    height: 28,
    borderRadius: "50%",
    fontWeight: 700,
    fontSize: 14,
  };
  if (rank === 1) return <span style={{ ...common, background: "#fef3c7", color: "#b45309" }}>🥇</span>;
  if (rank === 2) return <span style={{ ...common, background: "#f1f5f9", color: "#475569" }}>🥈</span>;
  if (rank === 3) return <span style={{ ...common, background: "#ffedd5", color: "#c2410c" }}>🥉</span>;
  return (
    <span style={{ ...common, background: "#f8fafc", color: "#64748b", fontFamily: "monospace", fontSize: 13 }}>
      {rank}
    </span>
  );
}

export function LeaderboardView() {
  const monthOptions = useMemo(() => rollingMonthOptions(18), []);

  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  const [selectedVertical, setSelectedVertical] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [month, setMonth] = useState(() => format(startOfMonth(new Date()), "yyyy-MM"));

  const [data, setData] = useState<StoreLeaderboardResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/stores")
      .then((r) => (r.ok ? r.json() : { stores: [] }))
      .then((d) => {
        setStores(d.stores ?? []);
        setStoresLoading(false);
      })
      .catch(() => setStoresLoading(false));
  }, []);

  const verticals = useMemo(() => {
    const set = new Set(stores.map((s) => s.vertical));
    return ["ELECTRONICS", "GROCERY", "FNL"].filter((v) => set.has(v));
  }, [stores]);

  const cities = useMemo(() => {
    if (!selectedVertical) return [];
    const set = new Set(stores.filter((s) => s.vertical === selectedVertical).map((s) => s.city));
    return Array.from(set).sort();
  }, [stores, selectedVertical]);

  const handleVerticalChange = (v: string) => {
    setSelectedVertical(v);
    setSelectedCity("");
    setData(null);
  };

  const handleCityChange = (c: string) => {
    setSelectedCity(c);
    setData(null);
  };

  const loadLeaderboard = useCallback(async () => {
    if (!selectedVertical || !selectedCity) return;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        vertical: selectedVertical,
        city: selectedCity,
        month,
      });
      const res = await fetch(`/api/leaderboard?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedVertical, selectedCity, month]);

  useEffect(() => {
    if (selectedVertical && selectedCity) void loadLeaderboard();
  }, [selectedVertical, selectedCity, month, loadLeaderboard]);

  const setThisMonth = () => setMonth(format(startOfMonth(new Date()), "yyyy-MM"));
  const setLastMonth = () => setMonth(format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM"));

  const breadcrumbItems = useMemo(() => {
    const items: { title: ReactNode }[] = [
      {
        title: (
          <Space size={6}>
            <Trophy size={14} style={{ color: "#d97706" }} />
            <span>Store leaderboard</span>
          </Space>
        ),
      },
    ];
    if (selectedVertical) {
      items.push({
        title: (
          <Tag color={verticalTagColor[selectedVertical]} style={{ margin: 0 }}>
            {verticalLabels[selectedVertical]}
          </Tag>
        ),
      });
    }
    if (selectedCity) items.push({ title: selectedCity });
    return items;
  }, [selectedVertical, selectedCity]);

  const tableColumns: ColumnsType<StoreLeaderboardRow> = useMemo(() => [
    {
      title: "Rank",
      dataIndex: "rank",
      width: 80,
      render: (rank: number) => <RankBadge rank={rank} />,
    },
    {
      title: "Store",
      key: "store",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.storeName}</Typography.Text>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
            {row.storeCode}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Target",
      dataIndex: "target",
      align: "right",
      width: 140,
      render: (v: number) => formatInr(v),
    },
    {
      title: "Actual",
      dataIndex: "actual",
      align: "right",
      width: 140,
      render: (v: number) => formatInr(v),
    },
    {
      title: "Achievement",
      dataIndex: "achievementPct",
      align: "right",
      width: 140,
      render: (v: number) => (
        <Typography.Text strong style={{ color: v >= 100 ? "#15803d" : v >= 85 ? "#b45309" : "#b91c1c" }}>
          {v.toFixed(1)}%
        </Typography.Text>
      ),
    },
  ], []);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb separator={<ChevronRight size={12} />} items={breadcrumbItems} />

      <Card size="small" title={<Space><Filter size={14} /><Typography.Text strong>Filters</Typography.Text></Space>}>
        {storesLoading ? (
          <Flex align="center" gap="small">
            <Spin size="small" />
            <Typography.Text type="secondary">Loading stores…</Typography.Text>
          </Flex>
        ) : (
          <Flex wrap="wrap" gap="large" align="flex-end">
            <Space direction="vertical" size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
                Vertical
              </Typography.Text>
              <Space wrap>
                {verticals.map((v) => (
                  <Button
                    key={v}
                    type={selectedVertical === v ? "primary" : "default"}
                    onClick={() => handleVerticalChange(v)}
                  >
                    {verticalLabels[v]}
                  </Button>
                ))}
              </Space>
            </Space>

            {selectedVertical ? (
              <Space direction="vertical" size={6}>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
                  <MapPin size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                  City
                </Typography.Text>
                <Select
                  style={{ minWidth: 200 }}
                  placeholder="Select city…"
                  value={selectedCity || undefined}
                  onChange={(v) => handleCityChange(v ?? "")}
                  options={cities.map((c) => ({ value: c, label: c }))}
                  allowClear
                />
              </Space>
            ) : null}

            {selectedCity ? (
              <Space direction="vertical" size={6}>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
                  <Calendar size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                  Period
                </Typography.Text>
                <Space wrap>
                  <Button size="small" onClick={setThisMonth}>This month</Button>
                  <Button size="small" onClick={setLastMonth}>Last month</Button>
                  <Select
                    style={{ minWidth: 160 }}
                    value={month}
                    onChange={setMonth}
                    options={monthOptions.map((m) => ({ value: m.value, label: m.label }))}
                  />
                </Space>
              </Space>
            ) : null}
          </Flex>
        )}
      </Card>

      {!selectedVertical && !loading ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Typography.Text type="secondary">Select a vertical to get started</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Stores are ranked by target achievement % within a city.
                </Typography.Text>
              </Space>
            }
          />
        </Card>
      ) : null}

      {selectedVertical && !selectedCity && !loading ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Typography.Text type="secondary">Select a city</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {cities.length} {cities.length === 1 ? "city" : "cities"} with {verticalLabels[selectedVertical]} stores
                </Typography.Text>
              </Space>
            }
          />
        </Card>
      ) : null}

      <Spin spinning={loading} tip="Loading leaderboard…">
        <Space direction="vertical" size="middle" style={{ width: "100%", minHeight: 80 }}>
          {loadError ? <Alert type="error" message={loadError} /> : null}

          {data && !loading ? (
            <>
              <Card size="small">
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <Space wrap align="center">
                    <Trophy size={16} style={{ color: "#d97706" }} />
                    <Typography.Text strong>Store leaderboard — {data.city}</Typography.Text>
                    <Typography.Text type="secondary">·</Typography.Text>
                    <Tag color={verticalTagColor[data.vertical]} style={{ margin: 0 }}>
                      {verticalLabels[data.vertical] ?? data.vertical}
                    </Tag>
                    <Typography.Text type="secondary">·</Typography.Text>
                    <Typography.Text strong>{data.period.label}</Typography.Text>
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                    Stores ranked by target achievement % (offline gross sales ÷ active target) for the period.
                  </Typography.Paragraph>
                </Space>
              </Card>

              <Table<StoreLeaderboardRow>
                rowKey="storeCode"
                size="small"
                scroll={{ x: "max-content" }}
                columns={tableColumns}
                dataSource={data.leaderboard}
                pagination={false}
                locale={{
                  emptyText: (
                    <Typography.Text type="secondary">No stores found for this selection</Typography.Text>
                  ),
                }}
              />

              <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                <Typography.Text strong>API:</Typography.Text>{" "}
                <Typography.Text code>
                  GET /api/leaderboard?vertical=ELECTRONICS&amp;city=Bijapur&amp;month=yyyy-MM
                </Typography.Text>
              </Typography.Paragraph>
            </>
          ) : null}
        </Space>
      </Spin>
    </Space>
  );
}
