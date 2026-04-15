import type { ThemeConfig } from "antd";

/** Aligns with `tailwind.config.ts`: sidebar, accent, surface */
export const SIDEBAR_BG = "#0F172A";
export const ACCENT = "#2563EB";
export const SURFACE = "#F8FAFC";

export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: ACCENT,
    colorBgLayout: SURFACE,
    colorBgContainer: "#ffffff",
    colorLink: ACCENT,
    borderRadiusLG: 12,
    borderRadius: 8,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      headerBg: SIDEBAR_BG,
      bodyBg: SURFACE,
      footerBg: SURFACE,
    },
    Menu: {
      darkItemBg: "transparent",
      darkItemHoverBg: "rgba(255,255,255,0.08)",
      darkItemSelectedBg: "rgba(255,255,255,0.14)",
      darkItemColor: "rgba(255,255,255,0.75)",
      horizontalItemSelectedColor: "#ffffff",
    },
    Card: {
      headerBg: "transparent",
    },
  },
};
