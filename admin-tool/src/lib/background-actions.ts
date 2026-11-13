"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { imageBackgrounds, sourceProducts } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { createSignedImageUpload, deleteGeneratedImage, publicImageUrl } from "@/lib/image-storage";
import { generateEnhancedShot } from "@/lib/enhanced-shot";

const UPLOAD_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function createBackgroundUploadUrl(contentType: string): Promise<{ signedUrl: string; path: string }> {
  await requireAuth();
  const ext = UPLOAD_TYPES[contentType];
  if (!ext) throw new Error("Nur JPG, PNG oder WebP.");
  return createSignedImageUpload(`backgrounds/${randomUUID()}.${ext}`);
}

export async function registerBackground(input: {
  name: string;
  description: string;
  categories: string[];
  path: string;
}): Promise<void> {
  await requireAuth();
  const name = input.name.trim();
  if (!name) throw new Error("Bitte einen Namen angeben.");
  if (!input.path.startsWith("backgrounds/") || input.path.includes("..")) throw new Error("Ungültiger Bildpfad.");
  const imageUrl = publicImageUrl(input.path);
  const res = await fetch(imageUrl, { method: "HEAD" });
  if (!res.ok) throw new Error(`Bild wurde nicht korrekt hochgeladen (${res.status}).`);
  await db.insert(imageBackgrounds).values({
    name,
    description: input.description.trim() || null,
    categories: input.categories,
    imageUrl,
    storagePath: input.path,
  });
  revalidatePath("/backgrounds");
}

export async function updateBackground(
  id: number,
  input: { name: string; description: string; categories: string[] },
): Promise<void> {
  await requireAuth();
  if (!input.name.trim()) throw new Error("Bitte einen Namen angeben.");
  await db
    .update(imageBackgrounds)
    .set({ name: input.name.trim(), description: input.description.trim() || null, categories: input.categories })
    .where(eq(imageBackgrounds.id, id));
  revalidatePath("/backgrounds");
}

export async function deleteBackground(id: number): Promise<void> {
  await requireAuth();
  const row = await db.query.imageBackgrounds.findFirst({ where: eq(imageBackgrounds.id, id) });
  if (!row) return;
  await db.delete(imageBackgrounds).where(eq(imageBackgrounds.id, id));
  await deleteGeneratedImage(row.storagePath).catch(() => {});
  revalidatePath("/backgrounds");
}

// Einzelprodukt: KI-Produktbild (erstes DG-Foto + Hintergrund) in Slot 1. backgroundId null = KI wählt.
export async function generateEnhancedShotForProduct(
  productId: number,
  backgroundId: number | null,
): Promise<{ backgroundName: string }> {
  await requireAuth();
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, productId) });
  if (!product) throw new Error("Artikel nicht gefunden.");
  const result = await generateEnhancedShot(product, backgroundId);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/", "layout");
  return result;
}
