"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { budgetSettings } from "@/db/schema";
import { requireAuth } from "@/lib/dal";

// Budget ist ein Singleton (immer id=1) - es gibt nur eine Obergrenze für das gesamte Admin-Tool,
// keine getrennten Budgets pro Nutzer o.ä.
const BUDGET_SETTINGS_ID = 1;

export async function updateTotalBudget(totalBudgetUsd: number): Promise<void> {
  await requireAuth();

  if (!Number.isFinite(totalBudgetUsd) || totalBudgetUsd < 0) {
    throw new Error("Budget muss eine Zahl größer oder gleich 0 sein.");
  }

  await db
    .insert(budgetSettings)
    .values({ id: BUDGET_SETTINGS_ID, totalBudgetUsd, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: budgetSettings.id,
      set: { totalBudgetUsd, updatedAt: new Date() },
    });

  // "layout" statt nur der aktuellen Seite, damit das Budget-Widget in der Sidebar auf jeder
  // Route sofort den neuen Wert zeigt, nicht erst nach einem harten Reload.
  revalidatePath("/", "layout");
}
