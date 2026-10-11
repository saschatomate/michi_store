"use server";

import { eq } from "drizzle-orm";
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
