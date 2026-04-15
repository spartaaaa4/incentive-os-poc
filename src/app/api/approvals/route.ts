export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchPendingApprovalItems } from "@/server/services/approvals-queue";

export async function GET(request: NextRequest) {
  try {
    const tab = request.nextUrl.searchParams.get("tab") ?? "pending";

    if (tab === "pending") {
      const items = await fetchPendingApprovalItems();
      return NextResponse.json({ items });
    }

    const history = await db.auditLog.findMany({
      orderBy: { performedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Approvals API error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
