import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { sourceProducts } from "../src/db/schema";
import { referenceImageUrl, fetchImageBuffer, guessMimeType } from "../src/lib/image-generation";
import { describeChainForImagePrompt } from "../src/lib/text-generation";

async function main() {
  const skus = ["4R267R8", "4P765G8"];
  for (const sku of skus) {
    const p = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, sku) });
    if (!p) { console.log(sku, "NOT FOUND"); continue; }
    const url = referenceImageUrl(p);
    if (!url) { console.log(sku, "no ref image"); continue; }
    const buf = await fetchImageBuffer(url);
    const desc = await describeChainForImagePrompt(buf, guessMimeType(url) as any, p.id);
    console.log("===", sku, "===");
    console.log("description:", desc);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
