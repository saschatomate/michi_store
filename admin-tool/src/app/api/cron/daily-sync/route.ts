import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runDailySync } from "@/lib/ftp-sync";

// Vercel Cron ruft diese Route täglich morgens auf (siehe vercel.json) und sendet dabei automatisch
// den Header "Authorization: Bearer <CRON_SECRET>", sobald CRON_SECRET als Env-Var im Vercel-Projekt
// gesetzt ist - alle anderen Aufrufe werden abgelehnt.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailySync();

  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/mapping");

  return NextResponse.json(result);
}
