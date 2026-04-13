"use client";

import { useEffect, useState } from "react";
import { Database, Loader2 } from "lucide-react";

async function checkStoresEmpty(): Promise<boolean> {
  try {
    const r = await fetch("/api/sales/filters");
    if (!r.ok) return false;
    const d = await r.json();
    return Array.isArray(d.stores) && d.stores.length === 0;
  } catch {
    return false;
  }
}

export function SeedBanner() {
  const [empty, setEmpty] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    checkStoresEmpty().then((isEmpty) => {
      if (isEmpty) {
        setTimeout(() => {
          checkStoresEmpty().then((stillEmpty) => {
            if (stillEmpty) setEmpty(true);
          });
        }, 1500);
      }
    });
  }, []);

  if (!empty || done) return null;

  const runSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed?force=true", { method: "POST" });
      if (res.ok) {
        setDone(true);
        setEmpty(false);
        setTimeout(() => window.location.reload(), 500);
      }
    } catch {
      /* ignore */
    }
    setSeeding(false);
  };

  return (
    <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Database size={20} className="text-amber-600" />
        <div>
          <p className="text-sm font-medium text-amber-900">Demo data missing or incomplete</p>
          <p className="text-xs text-amber-700">Load/reset demo data: 15 stores, 255 employees, ~3,300 sales transactions, targets, incentive rules, and calculated ledger.</p>
        </div>
      </div>
      <button onClick={() => void runSeed()} disabled={seeding}
        className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap">
        {seeding ? <><Loader2 size={14} className="animate-spin" /> Seeding...</> : "Reset & Load Demo Data"}
      </button>
    </div>
  );
}
