import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export interface JwtPayload {
  employerId: string;
  employeeId: string;
  role: string;
  storeCode: string;
  /** Denormalized admin flag. Fast-path for middleware; the authoritative
   *  source is `EmployeeMaster.hasAdminAccess` + `EmployeeAdminAccess`. */
  hasAdminAccess?: boolean;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required in production");
  }
  return secret ?? "incentive-os-dev-secret-local-only";
}

const JWT_SECRET = getJwtSecret();
const TOKEN_EXPIRY = "7d";

/** Cookie name for admin web sessions. Mobile clients still use Bearer. */
export const SESSION_COOKIE_NAME = "ios_session";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * Token extraction order:
 *   1. Authorization: Bearer <token>   (mobile app, API clients)
 *   2. Cookie ios_session=<token>      (admin web app)
 */
function extractToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice(7);
  }
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;
  return null;
}

export async function authenticateRequest(
  request: NextRequest,
): Promise<{ user: JwtPayload } | { error: NextResponse }> {
  const token = extractToken(request);
  if (!token) {
    return {
      error: NextResponse.json(
        { error: "Missing authorization token" },
        { status: 401 },
      ),
    };
  }

  try {
    const payload = verifyToken(token);

    const credential = await db.userCredential.findUnique({
      where: { employerId: payload.employerId },
      select: { isActive: true },
    });
    if (!credential?.isActive) {
      return {
        error: NextResponse.json(
          { error: "Account is deactivated" },
          { status: 403 },
        ),
      };
    }

    return { user: payload };
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      ),
    };
  }
}

/**
 * Attach the session cookie to a NextResponse. Used by /api/auth/login when
 * the caller is the admin web app. Mobile callers keep using the Bearer
 * token — they ignore the cookie.
 */
export function attachSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // 7 days — matches TOKEN_EXPIRY
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
