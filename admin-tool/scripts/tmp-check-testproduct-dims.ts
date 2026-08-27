import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const skus = ["4R267R8", "1JX45W852", "2G386W8", "4P765G8", "4L938W8"];
  const rows = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.modellErweitert, skus),
  });
  for (const r of rows) {
    const motif = [r.breite, r.hoehe].filter((v): v is number => v !== null && v > 0);
    const motifMm = motif.length ? Math.max(...motif) : (r.durchmesser ?? null);
    console.log({
      sku: r.modellErweitert,
      hauptkategorie: r.hauptkategorie,
      breite: r.breite,
      hoehe: r.hoehe,
      durchmesser: r.durchmesser,
      motifMm,
    });
  }
}
main().then(() => process.exit(0));
