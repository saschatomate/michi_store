"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { generateProductImageVariant } from "@/lib/image-generation";
import { signGeneratedImage } from "@/lib/c2pa-sign";
import { uploadGeneratedImage, deleteGeneratedImage } from "@/lib/image-storage";
import { assignModel, MARINELL_MODELS, POSE_VARIANTS, type MarinellModel, type PoseVariant } from "@/lib/image-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

// Löst das zugewiesene Model auf und persistiert es beim allerersten Aufruf für dieses Produkt
// dauerhaft (sourceProducts.assignedModelKey), damit spätere Neu-Generierungen garantiert dasselbe
// Model verwenden, auch wenn sich die Zuordnungsregel (assignModel) später ändert.
async function resolveAndPersistModel(product: SourceProductRow): Promise<MarinellModel> {
  if (product.assignedModelKey) {
    return MARINELL_MODELS[product.assignedModelKey as MarinellModel["key"]];
  }
  const key = assignModel(product);
  await db.update(sourceProducts).set({ assignedModelKey: key }).where(eq(sourceProducts.id, product.id));
  return MARINELL_MODELS[key];
}

async function generateAndSaveVariant(
  product: SourceProductRow,
  model: MarinellModel,
  poseVariant: PoseVariant,
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

  const label = `${model.name} – ${poseVariant.label}`;

  try {
    const { buffer, prompt } = await generateProductImageVariant(product, model, poseVariant);
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
          handPreset: label,
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
        handPreset: label,
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
        handPreset: label,
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

  const model = await resolveAndPersistModel(product);
  await Promise.all(
    POSE_VARIANTS.map((poseVariant, i) => generateAndSaveVariant(product, model, poseVariant, i)),
  );

  revalidatePath(`/products/${id}`);
}

// Speichert einen manuellen Prompt-Override (z.B. Korrektur für Innen-/Außenseite bei Armbändern)
// und generiert direkt neu - ersetzt nur nicht-freigegebene Varianten, wie bei "Neu generieren".
// Leerer String setzt den Override zurück auf den automatisch gebauten Standard-Prompt.
export async function updateImagePromptOverride(id: number, prompt: string): Promise<void> {
  await requireAuth();
  await db
    .update(sourceProducts)
    .set({ imagePromptOverride: prompt.trim() || null, updatedAt: new Date() })
    .where(eq(sourceProducts.id, id));

  await generateProductImages(id);
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

// Löscht genau diese eine Variante (Storage-Objekt + DB-Zeile). Der Slot (variantIndex) ist danach
// frei und wird beim nächsten "Bilder generieren" für dieses Produkt neu befüllt. Bewusst ohne
// Freigabe-Schutz - ein expliziter Löschvorgang auf ein einzelnes Bild ist immer erlaubt, anders als
// die pauschale Neu-Generierung, die freigegebene Varianten automatisch überspringt.
export async function deleteProductImageVariant(imageId: number): Promise<void> {
  await requireAuth();
  const row = await db.query.productGeneratedImages.findFirst({
    where: eq(productGeneratedImages.id, imageId),
  });
  if (!row) throw new Error("Bild nicht gefunden.");

  if (row.storagePath) {
    await deleteGeneratedImage(row.storagePath).catch(() => {});
  }
  await db.delete(productGeneratedImages).where(eq(productGeneratedImages.id, imageId));

  revalidatePath(`/products/${row.sourceProductId}`);
}

// Generiert nur diese eine Variante neu (gleiches zugewiesenes Model, gleiche Pose wie der Slot es
// vorsieht), lässt die anderen 2 Varianten unangetastet - anders als die pauschale
// "Neu generieren"-Aktion im Header, die alle nicht-freigegebenen Varianten gleichzeitig ersetzt.
export async function regenerateProductImageVariant(imageId: number): Promise<void> {
  await requireAuth();
  const row = await db.query.productGeneratedImages.findFirst({
    where: eq(productGeneratedImages.id, imageId),
  });
  if (!row) throw new Error("Bild nicht gefunden.");

  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.id, row.sourceProductId),
  });
  if (!product) throw new Error("Artikel nicht gefunden.");

  const model = await resolveAndPersistModel(product);
  const poseVariant = POSE_VARIANTS[row.variantIndex] ?? POSE_VARIANTS[0];
  await generateAndSaveVariant(product, model, poseVariant, row.variantIndex);

  revalidatePath(`/products/${row.sourceProductId}`);
}
