import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { sourceProducts } from "../src/db/schema";
import { MARINELL_MODELS, POSE_VARIANTS } from "../src/lib/image-facts";
import { compositeJewelryVariant } from "../src/lib/image-compositing";
import fs from "node:fs";

const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad/e2e";

async function main() {
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, "4R267R8") });
  if (!product) throw new Error("not found");
  const { buffer } = await compositeJewelryVariant(product, MARINELL_MODELS.sophia, POSE_VARIANTS.find(p => p.key === "frontal")!, 0);
  fs.writeFileSync(`${DIR}/hals-sophia-frontal.png`, buffer);
  console.log("done");
}
main().catch(e => { console.error(e); process.exit(1); });
