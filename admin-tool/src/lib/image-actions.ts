"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { generateProductImageVariant } from "@/lib/image-generation";
import { signGeneratedImage } from "@/lib/c2pa-sign";
import { uploadGeneratedImage, deleteGeneratedImage } from "@/lib/image-storage";
import { HAND_PRESETS, type HandPreset } from "@/lib/image-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

async function generateAndSaveVariant(
  product: SourceProductRow,
  preset: HandPreset,
  variantIndex: number,
): Promise<void> {
  const existing = await db.query.productGeneratedImages.findFirst({
    where: and(
      eq(productGeneratedImages.sourceProductId, product.id),
      eq(productGeneratedImages.variantIndex, variantIndex),
    ),
  });
  // Freigegebene Varianten bleiben bei Neu-Generierung unangetastet, damit ein Reviewer-Favorit
  // nicht versehentlich überschrieben wird.
  if (existing?.status === "approved") return;

  try {
    const { buffer, prompt } = await generateProductImageVariant(product, preset);
    const signed = await signGeneratedImage(buffer, prompt);
    const path = `generated/${product.id}/${variantIndex}-${Date.now()}.png`;
    const { url } = await uploadGeneratedImage(signed, path);

    if (existing?.storagePath) {
      await deleteGeneratedImage(existing.storagePath).catch(() => {});
    }

    if (existing) {
      await db
        .update(productGeneratedImages)
        .set({
          handPreset: preset.key,
          imageUrl: url,
          storagePath: path,
          status: "pending_review",
          approvedAt: null,
          generatedAt: new Date(),
          generationError: null,
        })
        .where(eq(productGeneratedImages.id, existing.id));
    } else {
      await db.insert(productGeneratedImages).values({
        sourceProductId: product.id,
        variantIndex,
        handPreset: preset.key,
        imageUrl: url,
        storagePath: path,
        status: "pending_review",
        generatedAt: new Date(),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[image-generation] Fehlgeschlagen für ${product.modellErweitert} Variante ${variantIndex}:`,
      err,
    );
    if (existing) {
      await db
        .update(productGeneratedImages)
        .set({ generationError: message })
        .where(eq(productGeneratedImages.id, existing.id));
    } else {
      await db.insert(productGeneratedImages).values({
        sourceProductId: product.id,
        variantIndex,
        handPreset: preset.key,
        status: "pending_review",
        generationError: message,
      });
    }
  }
}

// Wird sowohl für die Erstgenerierung als auch für "Neu generieren" verwendet - die Logik ist
// identisch (ersetzt nur nicht-freigegebene Varianten), nur das Button-Label unterscheidet sich.
export async function generateProductImages(id: number): Promise<void> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) throw new Error("Artikel nicht gefunden.");

  await Promise.all(HAND_PRESETS.map((preset, i) => generateAndSaveVariant(product, preset, i)));

  revalidatePath(`/products/${id}`);
}

export async function approveProductImage(imageId: number): Promise<void> {
  await requireAuth();
  const row = await db.query.productGeneratedImages.findFirst({
    where: eq(productGeneratedImages.id, imageId),
  });
  if (!row) throw new Error("Bild nicht gefunden.");

  await db
    .update(productGeneratedImages)
    .set({ status: "approved", approvedAt: new Date() })
    .where(eq(productGeneratedImages.id, imageId));

  revalidatePath(`/products/${row.sourceProductId}`);
}

export async function rejectProductImage(imageId: number): Promise<void> {
  await requireAuth();
  const row = await db.query.productGeneratedImages.findFirst({
    where: eq(productGeneratedImages.id, imageId),
  });
  if (!row) throw new Error("Bild nicht gefunden.");

  await db
    .update(productGeneratedImages)
    .set({ status: "rejected", approvedAt: null })
    .where(eq(productGeneratedImages.id, imageId));

  revalidatePath(`/products/${row.sourceProductId}`);
}
