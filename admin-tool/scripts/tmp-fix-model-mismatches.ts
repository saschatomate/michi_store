// Korrigiert die 7 vom Audit (tmp-audit-model-mismatch.ts) gefundenen Produkte: assignedModelKey
// zurück auf das Model, mit dem sie tatsächlich generiert wurden (aus handPreset rekonstruiert),
// statt es bei null zu lassen (wo die nächste Regenerierung sonst assignModel()'s Default einsetzen
// und damit das Model stillschweigend wechseln würde - exakt das Muster, das bei 4L938W8 fast
// passiert wäre). Reine Metadaten-Korrektur, rührt keine Bilder an.
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { MARINELL_MODELS } from "@/lib/image-facts";

const PRODUCT_IDS = [58232, 17009, 288422, 318841, 314433, 5027, 958];

function modelNameToKey(name: string): string | null {
  const entry = Object.entries(MARINELL_MODELS).find(([, m]) => m.name === name);
  return entry ? entry[0] : null;
}

async function main() {
  const products = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.id, PRODUCT_IDS),
  });

  for (const product of products) {
    const images = await db.query.productGeneratedImages.findMany({
      where: eq(productGeneratedImages.sourceProductId, product.id),
    });
    const usedNames = new Set(
      images.map((img) => img.handPreset?.split(" – ")[0]?.trim()).filter((n): n is string => Boolean(n)),
    );
    if (usedNames.size !== 1) {
      console.warn(
        `ÜBERSPRUNGEN id=${product.id} sku=${product.modellErweitert}: uneindeutige Historie (${[...usedNames].join(", ")}) - manuell prüfen.`,
      );
      continue;
    }
    const key = modelNameToKey([...usedNames][0]);
    if (!key) {
      console.warn(`ÜBERSPRUNGEN id=${product.id} sku=${product.modellErweitert}: Modelname "${[...usedNames][0]}" nicht auflösbar.`);
      continue;
    }
    await db.update(sourceProducts).set({ assignedModelKey: key }).where(eq(sourceProducts.id, product.id));
    console.log(`OK id=${product.id} sku=${product.modellErweitert}: assignedModelKey -> ${key}`);
  }
}

main().then(() => process.exit(0));
