"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Admin web login. POSTs to /api/auth/login — server sets the `ios_session`
 * httpOnly cookie. On success we redirect to `?next=` or `/dashboard`.
 *
 * The mobile app continues to use Bearer tokens against the same endpoint;
 * cookie support is strictly additive.
 */
export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [employerId, setEmployerId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employerId: employerId.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Login failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      if (!body.user?.hasAdminAccess) {
        setError("This account does not have admin access. Use the mobile app or ask your administrator.");
        setSubmitting(false);
        return;
      }
      router.replace(next);
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-md bg-blue-600 text-white text-xs font-bold flex items-center justify-center">IO</div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Incentive OS</h1>
            <p className="text-xs text-slate-500">Admin console</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Employer ID</label>
            <input
              value={employerId}
              onChange={(e) => setEmployerId(e.target.value)}
              autoFocus
              autoComplete="username"
              required
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </div>
          {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
