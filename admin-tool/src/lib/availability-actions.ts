"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { availabilityRules, productAuditLog, sourceProducts } from "@/db/schema";
import { requireAuth } from "@/lib/dal";

const RULE_KEYS = ["in_stock", "lab_grown", "natural", "shipping"] as const;

export async function updateAvailabilityRule(key: string, minValue: number, maxValue: number): Promise<void> {
  await requireAuth();
  if (!RULE_KEYS.includes(key as (typeof RULE_KEYS)[number])) throw new Error("Unbekannte Regel.");
  if (!Number.isInteger(minValue) || !Number.isInteger(maxValue) || minValue < 1 || maxValue < minValue || maxValue > 52) {
    throw new Error("Bitte ganze Zahlen angeben (von ≥ 1, bis ≥ von, höchstens 52).");
  }
  await db
    .update(availabilityRules)
    .set({ minValue, maxValue, updatedAt: new Date() })
    .where(eq(availabilityRules.key, key));
  revalidatePath("/availability");
  revalidatePath("/", "layout");
}

// Schalter "nicht mehr lieferbar" - für DG-Artikel und eigene Produkte. Wird protokolliert.
export async function setProductDiscontinued(id: number, discontinued: boolean): Promise<void> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.id, id),
    columns: { discontinued: true },
  });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (product.discontinued === discontinued) return;

  await db.update(sourceProducts).set({ discontinued, updatedAt: new Date() }).where(eq(sourceProducts.id, id));
  await db.insert(productAuditLog).values({
    sourceProductId: id,
    action: "updated",
    changes: { discontinued: { from: product.discontinued, to: discontinued } },
  });
  revalidatePath("/");
  revalidatePath(`/products/${id}`);
}
