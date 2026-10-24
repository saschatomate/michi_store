"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { requireAuth } from "@/lib/dal";

export type ShopDataInput = {
  title: string;
  price: string; // Dezimalzahl mit Komma oder Punkt; leer = automatischer Preis
  description: string;
};

// Speichert die manuellen Überschreibungen. Leeres Feld = zurück auf automatisch. Ist das Produkt
// schon in Shopify, erkennt die Prüfsumme die Änderung ("Shopify nicht aktuell") und der Knopf bzw.
// der nächtliche Abgleich zieht sie nach.
export async function updateShopData(id: number, input: ShopDataInput): Promise<void> {
  await requireAuth();

  let priceOverride: number | null = null;
  const rawPrice = input.price.trim().replace(/\s|€/g, "");
  if (rawPrice) {
    // "1.400,50" -> 1400.50, "1400.5" -> 1400.5
    const normalized = rawPrice.includes(",") ? rawPrice.replace(/\./g, "").replace(",", ".") : rawPrice;
    priceOverride = Number(normalized);
    if (!Number.isFinite(priceOverride) || priceOverride <= 0) throw new Error("Bitte einen gültigen Preis eingeben.");
  }

  await db
    .update(sourceProducts)
    .set({
      titleOverride: input.title.trim() || null,
      priceOverride,
      descriptionOverride: input.description.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(sourceProducts.id, id));

  revalidatePath(`/products/${id}`);
  revalidatePath("/");
}
