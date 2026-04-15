"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Layout, Menu, Typography, Space, theme } from "antd";
import type { MenuProps } from "antd";
import {
  BarChart3,
  ClipboardList,
  Database,
  Gauge,
  Target,
  Zap,
  User,
  Trophy,
  Building2,
} from "lucide-react";
import { SeedBanner } from "@/components/layout/seed-banner";
import { SIDEBAR_BG } from "@/lib/antd-theme";

const { Header, Content } = Layout;

const navItems: Array<{ href: string; label: string; icon: React.ReactNode }> = [
  { href: "/dashboard", label: "Dashboard", icon: <Gauge size={14} /> },
  { href: "/sales", label: "Sales", icon: <ClipboardList size={14} /> },
  { href: "/rules", label: "Rules", icon: <Zap size={14} /> },
  { href: "/targets", label: "Targets", icon: <Target size={14} /> },
  { href: "/approvals", label: "Approvals", icon: <BarChart3 size={14} /> },
  { href: "/leaderboard", label: "Leaderboard", icon: <Trophy size={14} /> },
  { href: "/reference", label: "Org reference", icon: <Building2 size={14} /> },
  { href: "/data-model", label: "Data Model", icon: <Database size={14} /> },
];

export function AdminChrome({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { token } = theme.useToken();

  const selectedKey = useMemo(() => {
    const matches = navItems.filter(
      (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
    );
    if (matches.length === 0) return pathname;
    return matches.sort((a, b) => b.href.length - a.href.length)[0]!.href;
  }, [pathname]);

  const menuItems: MenuProps["items"] = navItems.map((item) => ({
    key: item.href,
    icon: item.icon,
    label: (
      <Link href={item.href} style={{ color: "inherit" }}>
        <span className="hidden md:inline">{item.label}</span>
        <span className="md:hidden">{item.label.split(" ")[0]}</span>
      </Link>
    ),
  }));

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          paddingInline: 16,
          height: 56,
          lineHeight: "56px",
          background: SIDEBAR_BG,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: token.colorPrimary,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            IO
          </div>
          <Typography.Text strong style={{ color: "rgba(255,255,255,0.92)", fontSize: 14 }} className="hidden sm:inline">
            Incentive OS
          </Typography.Text>
        </Link>
        <Menu
          mode="horizontal"
          theme="dark"
          selectable
          selectedKeys={[selectedKey]}
          items={menuItems}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            borderBottom: "none",
            lineHeight: "56px",
          }}
        />
        <Space size="small" style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
          <User size={14} />
          <span className="hidden sm:inline">Admin</span>
        </Space>
      </Header>
      <Content style={{ background: token.colorBgLayout }}>
        <div
          style={{
            padding: "16px 24px",
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
        </div>
        <div style={{ paddingInline: 24 }}>
          <SeedBanner />
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </Content>
    </Layout>
  );
}
