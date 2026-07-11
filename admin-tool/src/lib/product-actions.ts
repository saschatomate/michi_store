"use server";

import { inArray, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sourceProducts, STATUS_VALUES, type ProductStatus } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { sendToPipelineWebhook } from "@/lib/pipeline-webhook";
import { generateProductContent, type GeneratedContent } from "@/lib/text-generation";

const MAX_PIPELINE_BATCH_SIZE = 20;

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
  return { sent: rows.length };
}

export async function updateProductStatus(id: number, status: ProductStatus): Promise<void> {
  await requireAuth();
  if (!STATUS_VALUES.includes(status)) {
    throw new Error(`Unbekannter Status: ${status}`);
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
