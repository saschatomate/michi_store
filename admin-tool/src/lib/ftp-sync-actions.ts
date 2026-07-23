"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/dal";
import { runDailySync, type DailySyncResult } from "@/lib/ftp-sync";

export async function triggerManualSync(): Promise<DailySyncResult> {
  await requireAuth();

  const result = await runDailySync();

  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/mapping");

  return result;
}
