import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";

async function main() {
  for (const kategorie of ["Armreifen", "Armbänder"]) {
    const rows = await db.query.sourceProducts.findMany({
      where: eq(sourceProducts.hauptkategorie, kategorie),
    });
    const total = rows.length;
    const withBreite = rows.filter((r) => r.breite && r.breite > 0).length;
    const withHoehe = rows.filter((r) => r.hoehe && r.hoehe > 0).length;
    const withDurchmesser = rows.filter((r) => r.durchmesser && r.durchmesser > 0).length;
    const withStaerke = rows.filter((r) => r.staerke && r.staerke > 0).length;
    const withLaenge = rows.filter((r) => r.produktLaengeCm && r.produktLaengeCm > 0).length;
    const withNoUsableSize = rows.filter(
      (r) => !((r.breite && r.breite > 0) || (r.hoehe && r.hoehe > 0)),
    ).length;
    console.log(`\n=== ${kategorie} (n=${total}) ===`);
    console.log({ withBreite, withHoehe, withDurchmesser, withStaerke, withLaenge, withNoUsableSize_forMotifSizeMm: withNoUsableSize });
    console.log("Beispiele (erste 8):");
    for (const r of rows.slice(0, 8)) {
      console.log({
        sku: r.modellErweitert,
        breite: r.breite,
        hoehe: r.hoehe,
        durchmesser: r.durchmesser,
        staerke: r.staerke,
        produktLaengeCm: r.produktLaengeCm,
        assignedModelKey: r.assignedModelKey,
      });
    }
  }

  // Existierende generierte Bilder für diese Kategorien?
  const armProducts = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.hauptkategorie, ["Armreifen", "Armbänder"]),
    columns: { id: true, modellErweitert: true, hauptkategorie: true },
  });
  const ids = armProducts.map((p) => p.id);
  const images = ids.length
    ? await db.query.productGeneratedImages.findMany({
        where: inArray(productGeneratedImages.sourceProductId, ids),
      })
    : [];
  console.log(`\n=== Generierte Bilder für Armreifen/Armbänder-Produkte: ${images.length} ===`);
  for (const img of images.slice(0, 20)) {
    const p = armProducts.find((pp) => pp.id === img.sourceProductId);
    console.log({
      sku: p?.modellErweitert,
      kategorie: p?.hauptkategorie,
      handPreset: img.handPreset,
      status: img.status,
      generatedAt: img.generatedAt,
      generationError: img.generationError,
    });
  }
}
main().then(() => process.exit(0));
