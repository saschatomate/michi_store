"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { productAuditLog, sourceProducts } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { shopReadinessProblems, syncProductToShopify, type ShopifyMode } from "@/lib/shopify-sync";

function refresh(id: number) {
  revalidatePath("/");
  revalidatePath("/mapping");
  revalidatePath(`/products/${id}`);
}

async function logStatus(id: number, from: string, to: string) {
  await db.insert(productAuditLog).values({ sourceProductId: id, action: "status", changes: { status: { from, to } } });
}

// Review -> Freigegeben: erst wenn Texte freigegeben sind und alles für den Shop da ist.
export async function approveProductForShop(id: number): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (product.status !== "review") {
    return { ok: false, problems: ["Nur Produkte im Status „Review offen“ können freigegeben werden"] };
  }
  const problems = await shopReadinessProblems(product);
  if (problems.length > 0) return { ok: false, problems };

  await db.update(sourceProducts).set({ status: "freigegeben", updatedAt: new Date() }).where(eq(sourceProducts.id, id));
  await logStatus(id, product.status, "freigegeben");
  refresh(id);
  return { ok: true };
}

export type PublishResult =
  | { ok: true; shopifyProductId: string; status: ShopifyMode; created: boolean }
  | { ok: false; error: string };

// Überträgt (oder aktualisiert) das Produkt in Shopify. Standard ist ein ENTWURF - "aktiv" muss
// bewusst gewählt werden. Fehler führen nicht zu einer Exception, sondern zum Status
// "Übertragungsfehler" mit Fehlertext am Produkt.
export async function publishProductToShopify(id: number, mode: ShopifyMode): Promise<PublishResult> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (!["freigegeben", "uebertragungsfehler", "veroeffentlicht"].includes(product.status)) {
    return { ok: false, error: "Das Produkt ist noch nicht für den Shop freigegeben." };
  }

  try {
    const result = await syncProductToShopify(id, { mode });
    if (product.status !== "veroeffentlicht") {
      await db.update(sourceProducts).set({ status: "veroeffentlicht" }).where(eq(sourceProducts.id, id));
      await logStatus(id, product.status, "veroeffentlicht");
    }
    refresh(id);
    return { ok: true, shopifyProductId: result.shopifyProductId, status: result.status, created: result.created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(sourceProducts)
      .set({ status: "uebertragungsfehler", shopifySyncError: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(sourceProducts.id, id));
    if (product.status !== "uebertragungsfehler") await logStatus(id, product.status, "uebertragungsfehler");
    refresh(id);
    return { ok: false, error: message };
  }
}
