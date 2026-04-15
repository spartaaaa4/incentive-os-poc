"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Space, Typography } from "antd";
import { Database, Loader2 } from "lucide-react";

async function checkNeedsReseed(): Promise<boolean> {
  try {
    const r = await fetch("/api/seed");
    if (!r.ok) return false;
    const d = await r.json();
    return d.needsReseed === true;
  } catch {
    return false;
  }
}

export function SeedBanner() {
  const [empty, setEmpty] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkNeedsReseed().then((needs) => {
      if (needs) {
        setTimeout(() => {
          checkNeedsReseed().then((stillNeeds) => {
            if (stillNeeds) setEmpty(true);
          });
        }, 1500);
      }
    });
  }, []);

  if (!empty || done) return null;

  const runSeed = async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch("/api/seed?force=true", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.stats?.ledgerRows > 0) {
        setDone(true);
        setEmpty(false);
        window.location.reload();
      } else {
        setError(data.message || data.error || "Seed completed but no incentive data was generated");
      }
    } catch (e) {
      setError(String(e));
    }
    setSeeding(false);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Alert
        type="warning"
        showIcon
        icon={<Database size={20} />}
        message={<Typography.Text strong>Demo data missing or incomplete</Typography.Text>}
        description={
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Load/reset demo data: 15 stores, 255 employees, ~3,300 sales transactions, targets, incentive rules, and calculated ledger.
            </Typography.Text>
            {error && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {error}
              </Typography.Text>
            )}
          </Space>
        }
        action={
          <Button
            type="default"
            onClick={() => void runSeed()}
            disabled={seeding}
            style={{ background: "#d97706", borderColor: "#b45309", color: "#fff" }}
          >
            {seeding ? (
              <Space size="small">
                <Loader2 size={14} className="animate-spin" />
                Seeding…
              </Space>
            ) : (
              "Reset & Load Demo Data"
            )}
          </Button>
        }
      />
    </div>
  );
}
