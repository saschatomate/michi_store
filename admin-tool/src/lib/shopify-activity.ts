import { and, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { productAuditLog, sourceProducts } from "@/db/schema";
import type { ShopifyChanges } from "@/lib/shopify-changes";

export type ShopifyEvent = {
  id: number;
  productId: number;
  action: string;
  actor: string;
  createdAt: Date;
  changes: ShopifyChanges | null;
};

const isShopifyAction = like(productAuditLog.action, "shopify_%");

// Jeweils das neueste Shopify-Ereignis pro Produkt (für die Kennzeichnung in der Produktliste).
export async function latestShopifyEvents(productIds: number[]): Promise<Map<number, ShopifyEvent>> {
  const out = new Map<number, ShopifyEvent>();
  if (productIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([productAuditLog.sourceProductId], {
      id: productAuditLog.id,
      productId: productAuditLog.sourceProductId,
      action: productAuditLog.action,
      actor: productAuditLog.actor,
      createdAt: productAuditLog.createdAt,
      changes: productAuditLog.changes,
    })
    .from(productAuditLog)
    .where(and(isShopifyAction, inArray(productAuditLog.sourceProductId, productIds)))
    .orderBy(productAuditLog.sourceProductId, desc(productAuditLog.createdAt));
  for (const r of rows) out.set(r.productId, r);
  return out;
}

export async function listShopifyEventsFor(productId: number, limit = 30): Promise<ShopifyEvent[]> {
  return db
    .select({
      id: productAuditLog.id,
      productId: productAuditLog.sourceProductId,
      action: productAuditLog.action,
      actor: productAuditLog.actor,
      createdAt: productAuditLog.createdAt,
      changes: productAuditLog.changes,
    })
    .from(productAuditLog)
    .where(and(isShopifyAction, eq(productAuditLog.sourceProductId, productId)))
    .orderBy(desc(productAuditLog.createdAt))
    .limit(limit);
}

export type ShopifyFeedItem = ShopifyEvent & { sku: string; name: string | null };

export async function listShopifyFeed(limit = 200): Promise<ShopifyFeedItem[]> {
  return db
    .select({
      id: productAuditLog.id,
      productId: productAuditLog.sourceProductId,
      action: productAuditLog.action,
      actor: productAuditLog.actor,
      createdAt: productAuditLog.createdAt,
      changes: productAuditLog.changes,
      sku: sourceProducts.modellErweitert,
      name: sourceProducts.kurzBezeichnungDe,
    })
    .from(productAuditLog)
    .innerJoin(sourceProducts, eq(sourceProducts.id, productAuditLog.sourceProductId))
    .where(isShopifyAction)
    .orderBy(desc(productAuditLog.createdAt))
    .limit(limit);
}

// Für den Zähler im Menü: was ist in den letzten 24 Stunden in Richtung Shopify passiert?
export async function shopifyActivityCounts(): Promise<{ changes24h: number; errors24h: number }> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db
    .select({ action: productAuditLog.action, count: sql<number>`count(*)::int` })
    .from(productAuditLog)
    .where(and(isShopifyAction, gte(productAuditLog.createdAt, since)))
    .groupBy(productAuditLog.action);
  let changes24h = 0;
  let errors24h = 0;
  for (const r of rows) {
    if (r.action === "shopify_error") errors24h += r.count;
    else changes24h += r.count;
  }
  return { changes24h, errors24h };
}
