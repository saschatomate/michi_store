import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productGeneratedImages, type sourceProducts } from "@/db/schema";

// Sammelauswahl: das erste DG-Produktbild wird automatisch als freigegebenes Bild in Slot 1 gelegt,
// damit der Artikel ohne Einzelbearbeitung nach Shopify kann. Weitere Bilder lassen sich danach in
// den übrigen Slots ergänzen. Ein bereits belegter Slot bleibt unangetastet.
export async function adoptFirstDgImage(product: typeof sourceProducts.$inferSelect): Promise<boolean> {
  const url = product.bildUrls?.[0] ?? product.freistellerUrl ?? product.modelbildUrl;
  if (!url) return false;
  const existing = await db.query.productGeneratedImages.findFirst({
    where: and(eq(productGeneratedImages.sourceProductId, product.id), eq(productGeneratedImages.variantIndex, 0)),
  });
  if (existing) return false;
  await db.insert(productGeneratedImages).values({
    sourceProductId: product.id,
    variantIndex: 0,
    handPreset: "DG-Originalbild",
    imageUrl: url,
    storagePath: null,
    status: "approved",
    approvedAt: new Date(),
    generatedAt: new Date(),
    isUpload: true,
  });
  return true;
}
