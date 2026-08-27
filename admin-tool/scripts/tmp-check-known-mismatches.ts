// Gezielter, schneller Re-Check der 7 SKUs aus dem letzten Audit (2026-08-26) + 4L938W8 - prüft, ob
// der heutige Katalog-Sync (Run #87, 2026-08-27 05:01 UTC) ihr assignedModelKey erneut auf null
// zurückgesetzt hat (der csv-import.ts-Fix wirkt nur für zukünftige Syncs, nicht rückwirkend).
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { inArray } from "drizzle-orm";

const SKUS = [
  "5G232W8",
  "1T327G450",
  "4R308R8",
  "5B153R8",
  "2O504R8",
  "1JS14G854",
  "1FT35WG854",
  "4L938W8",
];

const EXPECTED: Record<string, string> = {
  "5G232W8": "jen",
  "1T327G450": "amara",
  "4R308R8": "claire",
  "5B153R8": "amara",
  "2O504R8": "claire",
  "1JS14G854": "claire",
  "1FT35WG854": "jen",
  "4L938W8": "jen",
};

async function main() {
  const rows = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.modellErweitert, SKUS),
  });
  for (const sku of SKUS) {
    const row = rows.find((r) => r.modellErweitert === sku);
    if (!row) {
      console.log(`${sku}: NICHT GEFUNDEN`);
      continue;
    }
    const ok = row.assignedModelKey === EXPECTED[sku];
    console.log(
      `${sku}: assignedModelKey=${row.assignedModelKey ?? "NULL"} (erwartet: ${EXPECTED[sku]}) ${ok ? "OK" : "!! ABWEICHEND"}`,
    );
  }
}
main().then(() => process.exit(0));
