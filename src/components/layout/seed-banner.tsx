"use client";

import { useEffect, useState } from "react";
import { Database, Loader2 } from "lucide-react";

export function SeedBanner() {
  const [empty, setEmpty] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/sales/filters")
      .then((r) => (r.ok ? r.json() : { stores: [] }))
      .then((d) => { if (!d.stores?.length) setEmpty(true); })
      .catch(() => setEmpty(true));
  }, []);

  if (!empty || done) return null;

  const runSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      if (res.ok) {
        setDone(true);
        setEmpty(false);
        window.location.reload();
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
          <p className="text-sm font-medium text-amber-900">Database is empty</p>
          <p className="text-xs text-amber-700">Load demo data with 15 stores, 255 employees, ~3,300 sales transactions, targets, and pre-configured incentive rules.</p>
        </div>
      </div>
      <button onClick={() => void runSeed()} disabled={seeding}
        className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap">
        {seeding ? <><Loader2 size={14} className="animate-spin" /> Seeding...</> : "Load Demo Data"}
      </button>
    </div>
  );
}
