import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export interface JwtPayload {
  employerId: string;
  employeeId: string;
  role: string;
  storeCode: string;
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

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

function extractToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice(7);
  }
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
