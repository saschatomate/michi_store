"use server";

import { and, inArray, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sourceProducts, productCategories, STATUS_VALUES, type ProductStatus } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { sendToPipelineWebhook } from "@/lib/pipeline-webhook";
import { generateProductContent, type GeneratedContent } from "@/lib/text-generation";
import { getMissingFields, FIELD_LABELS } from "@/lib/custom-product";

const MAX_PIPELINE_BATCH_SIZE = 20;

// Selbst angelegte Produkte dürfen erst weiter in den Prozess, wenn alle Pflichtfelder gefüllt sind
// ("Daten unvollständig" ist eine harte Sperre, kein Hinweis). DG-Artikel sind nicht betroffen.
// Gibt für jedes gesperrte Produkt eine lesbare Meldung zurück.
async function blockedByIncompleteData(ids: number[]): Promise<string[]> {
  const rows = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.id, ids),
  });
  const blocked: string[] = [];
  for (const r of rows) {
    if (r.origin !== "custom") continue;
    const catCount = await db
      .select({ id: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.sourceProductId, r.id));
    const missing = getMissingFields(r, r.customImages?.length ?? 0, catCount.length);
    if (missing.length > 0) {
      blocked.push(`${r.modellErweitert}: ${missing.map((m) => FIELD_LABELS[m] ?? m).join(", ")}`);
    }
  }
  return blocked;
}

async function generateAndSave(product: typeof sourceProducts.$inferSelect): Promise<void> {
  try {
    const content = await generateProductContent(product);
    await db
      .update(sourceProducts)
      .set({
        genProductNameDe: content.productName,
        genShortDescDe: content.shortDescDe,
        genLongDescDe: content.longDescDe,
        genShortDescEn: content.shortDescEn,
        genLongDescEn: content.longDescEn,
        genSeoTitle: content.seoTitle,
        genSeoDescription: content.seoDescription,
        contentGeneratedAt: new Date(),
        contentGenerationError: null,
        status: "review",
        updatedAt: new Date(),
      })
      .where(eq(sourceProducts.id, product.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[text-generation] Fehlgeschlagen für ${product.modellErweitert}:`, message);
    await db
      .update(sourceProducts)
      .set({ contentGenerationError: message, updatedAt: new Date() })
      .where(eq(sourceProducts.id, product.id));
  }
}

export async function sendSelectedToPipeline(ids: number[]): Promise<{ sent: number }> {
  await requireAuth();
  if (ids.length === 0) return { sent: 0 };
  if (ids.length > MAX_PIPELINE_BATCH_SIZE) {
    throw new Error(`Maximal ${MAX_PIPELINE_BATCH_SIZE} Artikel gleichzeitig senden.`);
  }

  const blocked = await blockedByIncompleteData(ids);
  if (blocked.length > 0) {
    throw new Error(`Daten unvollständig, nicht gesendet - ${blocked.join(" | ")}`);
  }
  const discontinued = await db
    .select({ sku: sourceProducts.modellErweitert })
    .from(sourceProducts)
    .where(and(inArray(sourceProducts.id, ids), eq(sourceProducts.discontinued, true)));
  if (discontinued.length > 0) {
    throw new Error(`Nicht mehr lieferbar, nicht gesendet - ${discontinued.map((d) => d.sku).join(", ")}`);
  }

  const rows = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.id, ids),
  });

  await db
    .update(sourceProducts)
    .set({
      status: "in_pipeline",
      sentToPipelineAt: new Date(),
      updatedAt: new Date(),
    })
    .where(inArray(sourceProducts.id, ids));

  await Promise.all(
    rows.map((r) => sendToPipelineWebhook({ sourceProductId: r.id, modellErweitert: r.modellErweitert })),
  );

  // Textgenerierung parallel je Artikel; einzelne Fehler landen in contentGenerationError statt
  // den gesamten Batch abzubrechen.
  await Promise.all(rows.map((r) => generateAndSave(r)));

  revalidatePath("/");
  revalidatePath("/mapping");
  revalidatePath("/", "layout");
  return { sent: rows.length };
}

export async function updateProductStatus(id: number, status: ProductStatus): Promise<void> {
  await requireAuth();
  if (!STATUS_VALUES.includes(status)) {
    throw new Error(`Unbekannter Status: ${status}`);
  }
  // "Daten unvollständig" wird nur automatisch vergeben/aufgehoben (Editor), nie von Hand - und
  // darüber hinaus gilt: ein unvollständiges eigenes Produkt darf nicht in Folge-Status wechseln.
  if (status === "unvollstaendig") {
    throw new Error('Der Status "Daten unvollständig" wird automatisch vom Editor gesetzt.');
  }
  // Diese drei entstehen nur über die Shop-Freigabe/-Übertragung (shopify-actions.ts) - von Hand
  // gesetzt würden sie die Prüfungen umgehen bzw. einen Shopify-Stand vortäuschen.
  if (["freigegeben", "veroeffentlicht", "uebertragungsfehler"].includes(status)) {
    throw new Error("Dieser Status wird nur über „Für den Shop freigeben“ bzw. die Shopify-Übertragung gesetzt.");
  }
  if (!["abgelehnt", "archiviert"].includes(status)) {
    const blocked = await blockedByIncompleteData([id]);
    if (blocked.length > 0) throw new Error(`Daten unvollständig - ${blocked[0]}`);
  }

  await db
    .update(sourceProducts)
    .set({ status, updatedAt: new Date() })
    .where(eq(sourceProducts.id, id));

  revalidatePath("/");
  revalidatePath(`/products/${id}`);
  revalidatePath("/mapping");
}

export async function regenerateProductContent(id: number): Promise<void> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) throw new Error("Artikel nicht gefunden.");

  await db
    .update(sourceProducts)
    .set({ contentApprovedAt: null, updatedAt: new Date() })
    .where(eq(sourceProducts.id, id));

  await generateAndSave(product);

  revalidatePath(`/products/${id}`);
  revalidatePath("/");
  revalidatePath("/mapping");
  revalidatePath("/", "layout");
}

export async function approveProductContent(id: number): Promise<void> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.id, id),
    columns: { status: true, contentGeneratedAt: true },
  });
  if (!product) throw new Error("Artikel nicht gefunden.");
  if (product.status !== "review" || !product.contentGeneratedAt) {
    throw new Error("Artikel ist nicht im Review-Status mit generierten Texten.");
  }

  await db
    .update(sourceProducts)
    .set({ contentApprovedAt: new Date(), updatedAt: new Date() })
    .where(eq(sourceProducts.id, id));

  revalidatePath(`/products/${id}`);
  revalidatePath("/");
  revalidatePath("/mapping");
}

export async function updateProductContent(id: number, content: GeneratedContent): Promise<void> {
  await requireAuth();

  const trimmed = {
    productName: content.productName.trim(),
    shortDescDe: content.shortDescDe.trim(),
    longDescDe: content.longDescDe.trim(),
    shortDescEn: content.shortDescEn.trim(),
    longDescEn: content.longDescEn.trim(),
    seoTitle: content.seoTitle.trim(),
    seoDescription: content.seoDescription.trim(),
  };
  if (Object.values(trimmed).some((v) => v.length === 0)) {
    throw new Error("Alle Textfelder müssen ausgefüllt sein.");
  }

  await db
    .update(sourceProducts)
    .set({
      genProductNameDe: trimmed.productName,
      genShortDescDe: trimmed.shortDescDe,
      genLongDescDe: trimmed.longDescDe,
      genShortDescEn: trimmed.shortDescEn,
      genLongDescEn: trimmed.longDescEn,
      genSeoTitle: trimmed.seoTitle,
      genSeoDescription: trimmed.seoDescription,
      contentApprovedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(sourceProducts.id, id));

  revalidatePath(`/products/${id}`);
  revalidatePath("/");
  revalidatePath("/mapping");
}

export async function rejectProductContent(id: number): Promise<void> {
  await requireAuth();

  await db
    .update(sourceProducts)
    .set({ status: "abgelehnt", updatedAt: new Date() })
    .where(eq(sourceProducts.id, id));

  revalidatePath(`/products/${id}`);
  revalidatePath("/");
  revalidatePath("/mapping");
}
