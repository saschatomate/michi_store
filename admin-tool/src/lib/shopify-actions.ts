"use server";

import { and, eq, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { productAuditLog, sourceProducts } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { publishAndRecord, shopReadinessProblems, type ShopifyMode } from "@/lib/shopify-sync";

function refresh(id: number) {
  revalidatePath("/");
  revalidatePath("/mapping");
  revalidatePath(`/products/${id}`);
}

async function logStatus(id: number, from: string, to: string) {
  await db.insert(productAuditLog).values({ sourceProductId: id, action: "status", changes: { status: { from, to } } });
}

// Freigeben für den Shop: sobald Preis, Bild und Pflichtdaten da sind - ein KI-Text ist nicht mehr nötig,
// die Beschreibung entsteht aus Kategorie-Intro und Produktdaten (shop-data.ts).
const APPROVABLE_STATUSES = ["neu", "ausgewaehlt", "in_pipeline", "review"];
export async function approveProductForShop(id: number): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (!APPROVABLE_STATUSES.includes(product.status)) {
    return { ok: false, problems: ["Dieser Status lässt keine Freigabe für den Shop zu"] };
  }
  const problems = await shopReadinessProblems(product);
  if (problems.length > 0) return { ok: false, problems };

  await db.update(sourceProducts).set({ status: "freigegeben", updatedAt: new Date() }).where(eq(sourceProducts.id, id));
  await logStatus(id, product.status, "freigegeben");
  refresh(id);
  return { ok: true };
}

export type PublishResult =
  | { ok: true; shopifyProductId: string; status: "draft" | "active" | "archived"; created: boolean; skipped: boolean }
  | { ok: false; error: string };

// Überträgt (oder aktualisiert) das Produkt in Shopify. Standard ist ein ENTWURF - "aktiv" muss
// bewusst gewählt werden; "keep" behält den bisherigen Shopify-Status bei. Fehler führen nicht zu
// einer Exception, sondern zum Status "Übertragungsfehler" mit Fehlertext am Produkt.
export async function publishProductToShopify(id: number, mode: ShopifyMode | "keep"): Promise<PublishResult> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (!["freigegeben", "uebertragungsfehler", "veroeffentlicht"].includes(product.status)) {
    return { ok: false, error: "Das Produkt ist noch nicht für den Shop freigegeben." };
  }

  const result = await publishAndRecord(id, { mode });
  refresh(id);
  return result;
}


// Fehlgeschlagene Shopify-Ereignisse aus dem Verlauf entfernen (nur shopify_error, nie erfolgreiche Änderungen).
export async function deleteShopifyError(eventId: number): Promise<void> {
  await requireAuth();
  await db.delete(productAuditLog).where(and(eq(productAuditLog.id, eventId), eq(productAuditLog.action, "shopify_error")));
  revalidatePath("/shopify-changes");
  revalidatePath("/products/[id]", "page");
}

export async function deleteShopifyErrorsOlderThan(days: number): Promise<{ deleted: number }> {
  await requireAuth();
  if (!Number.isFinite(days) || days < 0) throw new Error("Ungültige Anzahl Tage.");
  const before = new Date(Date.now() - days * 24 * 3_600_000);
  const rows = await db
    .delete(productAuditLog)
    .where(and(eq(productAuditLog.action, "shopify_error"), lt(productAuditLog.createdAt, before)))
    .returning({ id: productAuditLog.id });
  revalidatePath("/shopify-changes");
  revalidatePath("/products/[id]", "page");
  return { deleted: rows.length };
}
