import { NextResponse } from "next/server";
import { z } from "zod";
import { recalculateStoreMonth } from "@/server/calculations/engines";

const schema = z.object({
  storeCode: z.string().min(1),
  month: z.string().min(1),
});

export async function POST(request: Request) {
  const payload = schema.parse(await request.json());
  await recalculateStoreMonth(payload.storeCode, new Date(payload.month));
  return NextResponse.json({ ok: true });
}
