"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Typography, Space, theme } from "antd";
import type { MenuProps } from "antd";
import {
  BarChart3,
  ClipboardList,
  Database,
  Gauge,
  Network,
  Target,
  Zap,
  User,
  Users,
  Trophy,
  Building2,
  CalendarCheck,
  LogOut,
} from "lucide-react";
import { SeedBanner } from "@/components/layout/seed-banner";
import { SIDEBAR_BG } from "@/lib/antd-theme";

type Me = {
  employeeId: string;
  employeeName: string;
  role: string;
  hasAdminAccess: boolean;
  adminAccess: {
    verticals: string[];
    canViewAll: boolean;
    canEditIncentives: boolean;
    canApprove: boolean;
    canManageUsers: boolean;
  } | null;
};

const { Header, Content } = Layout;

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Only show this nav item when the signed-in admin has this flag. */
  requires?: "canManageUsers";
};

const navItems: Array<NavItem> = [
  { href: "/dashboard", label: "Dashboard", icon: <Gauge size={14} /> },
  { href: "/sales", label: "Sales", icon: <ClipboardList size={14} /> },
  { href: "/attendance", label: "Attendance", icon: <CalendarCheck size={14} /> },
  { href: "/rules", label: "Rules", icon: <Zap size={14} /> },
  { href: "/targets", label: "Targets", icon: <Target size={14} /> },
  { href: "/approvals", label: "Approvals", icon: <BarChart3 size={14} /> },
  { href: "/leaderboard", label: "Leaderboard", icon: <Trophy size={14} /> },
  { href: "/admins", label: "Admins", icon: <Users size={14} />, requires: "canManageUsers" },
  { href: "/reference", label: "Org reference", icon: <Building2 size={14} /> },
  { href: "/data-model", label: "Data Model", icon: <Database size={14} /> },
  { href: "/architecture", label: "Architecture", icon: <Network size={14} /> },
];

export function AdminChrome({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { token } = theme.useToken();
  const [me, setMe] = useState<Me | null>(null);
  const [meChecked, setMeChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        return body.user as Me;
      })
      .then((user) => {
        if (cancelled) return;
        if (!user.hasAdminAccess) {
          router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
          return;
        }
        setMe(user);
        setMeChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    router.replace("/login");
  }

  const visibleNav = useMemo(() => {
    return navItems.filter((item) => {
      if (!item.requires) return true;
      return Boolean(me?.adminAccess?.[item.requires]);
    });
  }, [me]);

  const selectedKey = useMemo(() => {
    const matches = visibleNav.filter(
      (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
    );
    if (matches.length === 0) return pathname;
    return matches.sort((a, b) => b.href.length - a.href.length)[0]!.href;
  }, [pathname, visibleNav]);

  // Don't render the admin chrome until we've verified admin access. Prevents
  // a flash of UI before the /login redirect fires.
  if (!meChecked || !me) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  const menuItems: MenuProps["items"] = visibleNav.map((item) => ({
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
        <Space size="small" style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
          <User size={14} />
          <span className="hidden sm:inline">{me?.employeeName ?? "…"}</span>
          {me && (
            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                color: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.2)",
                padding: "4px 8px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                marginLeft: 8,
              }}
            >
              <LogOut size={12} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
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
          {description ? (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, maxWidth: 900 }}>
              {description}
            </Typography.Paragraph>
          ) : null}
        </div>
        <div style={{ paddingInline: 24 }}>
          <SeedBanner />
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </Content>
    </Layout>
  );
}
