import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const PUBLIC_ROUTES = [
  "/api/auth/login",
  "/api/auth/me",
  "/api/health",
  "/api/dashboard",
  "/api/incentives",
  "/api/sales",
  "/api/approvals",
  "/api/targets",
  "/api/rules",
  "/api/employees",
  "/api/stores",
  "/api/recalculate",
  "/api/leaderboard",
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

  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next();
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

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing authorization token" },
      { status: 401, headers },
    );
  }

  try {
    const payload = verifyToken(authHeader.slice(7));

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-employer-id", payload.employerId);
    requestHeaders.set("x-user-employee-id", payload.employeeId);
    requestHeaders.set("x-user-role", payload.role);
    requestHeaders.set("x-user-store-code", payload.storeCode);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers },
    );
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
