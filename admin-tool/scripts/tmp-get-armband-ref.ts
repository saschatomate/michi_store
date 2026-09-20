import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const rows = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.modellErweitert, ["6B546W8", "5F564W8", "5G232W8"]),
  });
  for (const r of rows) {
    console.log({
      sku: r.modellErweitert,
      breite: r.breite,
      hoehe: r.hoehe,
      staerke: r.staerke,
      produktLaengeCm: r.produktLaengeCm,
      freistellerUrl: r.freistellerUrl,
    });
  }
}
main().then(() => process.exit(0));
