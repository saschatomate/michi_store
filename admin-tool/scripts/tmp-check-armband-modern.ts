import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";

async function main() {
  const armProducts = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.hauptkategorie, ["Armreifen", "Armbänder"]),
  });
  const ids = armProducts.map((p) => p.id);
  const images = await db.query.productGeneratedImages.findMany({
    where: inArray(productGeneratedImages.sourceProductId, ids),
  });
  const modern = images.filter((img) => img.handPreset?.includes(" – "));
  console.log(`Modern-style (Sophia/Claire/Jen/Amara) images: ${modern.length} / ${images.length} total`);
  for (const img of modern) {
    const p = armProducts.find((pp) => pp.id === img.sourceProductId)!;
    console.log({
      sku: p.modellErweitert,
      kategorie: p.hauptkategorie,
      breite: p.breite,
      hoehe: p.hoehe,
      durchmesser: p.durchmesser,
      staerke: p.staerke,
      handPreset: img.handPreset,
      imageUrl: img.imageUrl,
      status: img.status,
    });
  }
}
main().then(() => process.exit(0));
