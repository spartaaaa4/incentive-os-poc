export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, attachSessionCookie } from "@/lib/auth";

const loginSchema = z.object({
  employerId: z.string().trim().min(1, "Employer ID is required"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    const { employerId, password } = parsed.data;
    const credential = await db.userCredential.findUnique({
      where: { employerId },
      include: {
        employee: {
          include: {
            store: true,
            adminAccess: true,
          },
        },
      },
    });

    if (!credential || !credential.isActive) {
      return NextResponse.json({ error: "Invalid employer ID or password" }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, credential.password);
    if (!passwordMatch) {
      return NextResponse.json({ error: "Invalid employer ID or password" }, { status: 401 });
    }

    await db.userCredential.update({
      where: { id: credential.id },
      data: { lastLoginAt: new Date() },
    });

    const emp = credential.employee;
    const hasAdminAccess = Boolean(emp.hasAdminAccess && emp.adminAccess);

    const token = signToken({
      employerId: credential.employerId,
      employeeId: emp.employeeId,
      role: emp.role,
      storeCode: emp.storeCode,
      hasAdminAccess,
    });

    const adminAccess = hasAdminAccess && emp.adminAccess
      ? {
          verticals: emp.adminAccess.verticals,
          canViewAll: emp.adminAccess.canViewAll,
          canEditIncentives: emp.adminAccess.canEditIncentives,
          canSubmitApproval: emp.adminAccess.canSubmitApproval,
          canApprove: emp.adminAccess.canApprove,
          canManageUsers: emp.adminAccess.canManageUsers,
          canUploadData: emp.adminAccess.canUploadData,
        }
      : null;

    const response = NextResponse.json({
      ok: true,
      token,
      user: {
        employerId: credential.employerId,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        role: emp.role,
        storeCode: emp.storeCode,
        storeName: emp.store.storeName,
        vertical: emp.store.vertical,
        storeFormat: emp.store.storeFormat,
        city: emp.store.city,
        state: emp.store.state,
        storeStatus: emp.store.storeStatus,
        hasAdminAccess,
        adminAccess,
      },
    });

    // Cookie session for admin web app. Mobile clients ignore it and keep
    // using the Bearer token from the response body.
    return attachSessionCookie(response, token);
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
