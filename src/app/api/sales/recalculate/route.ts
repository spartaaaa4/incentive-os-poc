export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recalculateStoreMonth } from "@/server/calculations/engines";
import { requirePermission } from "@/lib/permissions";

const schema = z.object({
  storeCode: z.string().min(1),
  month: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, "canEditIncentives");
  if ("error" in auth) return auth.error;

  const payload = schema.parse(await request.json());
  await recalculateStoreMonth(payload.storeCode, new Date(payload.month), {
    trigger: "MANUAL_RECOMPUTE",
  });
  return NextResponse.json({ ok: true });
}
