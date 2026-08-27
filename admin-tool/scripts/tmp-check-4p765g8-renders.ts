import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.modellErweitert, "4P765G8"),
  });
  if (!product) {
    console.log("Produkt nicht gefunden");
    return;
  }
  console.log("Produkt:", {
    id: product.id,
    modellErweitert: product.modellErweitert,
    hauptkategorie: product.hauptkategorie,
    freistellerUrl: product.freistellerUrl,
    modelbildUrl: product.modelbildUrl,
    produktLaengeCm: product.produktLaengeCm,
    assignedModelKey: (product as any).assignedModelKey,
  });

  const images = await db.query.productGeneratedImages.findMany({
    where: eq(productGeneratedImages.sourceProductId, product.id),
  });
  console.log(`\n${images.length} generierte Bilder:`);
  for (const img of images.sort((a, b) => a.id - b.id)) {
    console.log({
      id: img.id,
      variantIndex: img.variantIndex,
      handPreset: img.handPreset,
      status: img.status,
      imageUrl: img.imageUrl,
      storagePath: img.storagePath,
      generatedAt: img.generatedAt,
      createdAt: img.createdAt,
      generationError: img.generationError,
    });
  }
}

main().then(() => process.exit(0));
