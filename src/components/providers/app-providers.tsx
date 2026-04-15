"use client";

import { ConfigProvider, App as AntdApp } from "antd";
import { adminTheme } from "@/lib/antd-theme";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider theme={adminTheme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
