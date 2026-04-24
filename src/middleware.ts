import { NextRequest, NextResponse } from "next/server";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * Routes that do NOT require a session token at the middleware layer. Some of
 * these (writes like `/api/rules/submit`, `/api/approvals/action`) still run
 * `requirePermission(...)` inside the handler — middleware just won't reject
 * an anonymous caller upfront. That preserves read-only flows (mobile app,
 * admin dashboard reads) while letting handlers enforce RBAC.
 */
const PUBLIC_ROUTES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/health",
  "/api/dashboard",
  // `/api/incentives` intentionally NOT public — it takes `employeeId` as a
  // query param and returns that employee's payout. Handler enforces
  // self-access OR admin `canViewAll` scoped to the target's vertical.
  "/api/sales",
  "/api/approvals",
  "/api/targets",
  "/api/rules",
  "/api/employees",
  "/api/stores",
  "/api/recalculate",
  "/api/leaderboard",
  "/api/attendance",
];

const INTERNAL_ROUTES = [
  "/api/seed",
];

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin =
    ALLOWED_ORIGIN === "*"
      ? "*"
      : origin && ALLOWED_ORIGIN.split(",").map((o) => o.trim()).includes(origin)
        ? origin
        : "";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function extractToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

function attachUserHeaders(headers: Headers, token: string): boolean {
  try {
    const payload = verifyToken(token);
    headers.set("x-user-employer-id", payload.employerId);
    headers.set("x-user-employee-id", payload.employeeId);
    headers.set("x-user-role", payload.role);
    headers.set("x-user-store-code", payload.storeCode);
    if (payload.hasAdminAccess) headers.set("x-user-has-admin-access", "1");
    return true;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const token = extractToken(request);

  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // Public: pass through. If the caller sent a valid token, attach user
    // headers so handlers can do their own permission check when needed.
    const requestHeaders = new Headers(request.headers);
    if (token) attachUserHeaders(requestHeaders, token);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  if (INTERNAL_ROUTES.some((route) => pathname.startsWith(route))) {
    const seedEnabled = process.env.ENABLE_SEED === "true";
    if (!seedEnabled) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    }
    const response = NextResponse.next();
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  if (!token) {
    return NextResponse.json(
      { error: "Missing authorization token" },
      { status: 401, headers },
    );
  }

  const requestHeaders = new Headers(request.headers);
  if (!attachUserHeaders(requestHeaders, token)) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers },
    );
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
