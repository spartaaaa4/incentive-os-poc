export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken } from "@/lib/auth";

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
      include: { employee: { include: { store: true } } },
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

    const token = signToken({
      employerId: credential.employerId,
      employeeId: credential.employee.employeeId,
      role: credential.employee.role,
      storeCode: credential.employee.storeCode,
    });

    return NextResponse.json({
      ok: true,
      token,
      user: {
        employerId: credential.employerId,
        employeeId: credential.employee.employeeId,
        employeeName: credential.employee.employeeName,
        role: credential.employee.role,
        storeCode: credential.employee.storeCode,
        storeName: credential.employee.store.storeName,
        vertical: credential.employee.store.vertical,
        storeFormat: credential.employee.store.storeFormat,
        city: credential.employee.store.city,
        state: credential.employee.store.state,
        storeStatus: credential.employee.store.storeStatus,
      },
    });
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
