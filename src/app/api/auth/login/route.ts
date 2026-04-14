import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

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
      include: { employee: true },
    });

    if (!credential || !credential.isActive || credential.password !== password) {
      return NextResponse.json({ error: "Invalid employer ID or password" }, { status: 401 });
    }

    await db.userCredential.update({
      where: { id: credential.id },
      data: { lastLoginAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      user: {
        employerId: credential.employerId,
        employeeId: credential.employee.employeeId,
        employeeName: credential.employee.employeeName,
        role: credential.employee.role,
        storeCode: credential.employee.storeCode,
      },
    });
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
