import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { sourceProducts } from "../src/db/schema";

async function main() {
  const skus = ["4R267R8", "4P765G8"];
  for (const sku of skus) {
    const p = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, sku) });
    if (!p) { console.log(sku, "NOT FOUND"); continue; }
    console.log("===", sku, "===");
    console.log("kurzBezeichnungDe:", p.kurzBezeichnungDe);
    console.log("langBezeichnungDe:", p.langBezeichnungDe);
    console.log("hauptmaterial:", p.hauptmaterial, "legierung:", p.legierung);
    const raw = p.rawJson as Record<string, string> | null;
    if (raw) {
      const keys = Object.keys(raw).filter(k => /kette|glied|chain|link|verschluss/i.test(k));
      console.log("raw keys matching kette/glied/chain/link/verschluss:", keys);
      for (const k of keys) console.log(`  ${k}: ${raw[k]}`);
    }
  }
  process.exit(0);
}
main();
