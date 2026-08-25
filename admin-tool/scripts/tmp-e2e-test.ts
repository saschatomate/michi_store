import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { sourceProducts } from "../src/db/schema";
import { MARINELL_MODELS, POSE_VARIANTS } from "../src/lib/image-facts";
import { compositeJewelryVariant } from "../src/lib/image-compositing";
import fs from "node:fs";

const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad/e2e";
fs.mkdirSync(DIR, { recursive: true });

const RING_SKU = "1JX45W852";
const OHR_SKU = "2G386W8";
const HALS_SKU = "4R267R8";

async function findBySku(sku: string) {
  const row = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, sku) });
  if (!row) throw new Error(`Produkt ${sku} nicht gefunden`);
  return row;
}

async function renderOne(product: any, modelKey: string, poseKey: string, label: string) {
  const model = MARINELL_MODELS[modelKey as keyof typeof MARINELL_MODELS];
  const pose = POSE_VARIANTS.find((p) => p.key === poseKey)!;
  try {
    const { buffer } = await compositeJewelryVariant(product, model, pose, 0);
    fs.writeFileSync(`${DIR}/${label}.png`, buffer);
    console.log(`OK   ${label}`);
  } catch (e: any) {
    console.log(`FAIL ${label}: ${e.message}`);
  }
}

async function main() {
  const mode = process.argv[2] || "ring-ohr";

  if (mode === "ring-ohr") {
    const ringProduct = await findBySku(RING_SKU);
    const ohrProduct = await findBySku(OHR_SKU);
    const models = ["sophia", "claire", "jen", "amara"];
    const poses = ["frontal", "dreiviertelprofil", "seitlich"];
    const tasks: Promise<void>[] = [];
    for (const m of models) {
      for (const p of poses) {
        tasks.push(renderOne(ringProduct, m, p, `ring-${m}-${p}`));
        tasks.push(renderOne(ohrProduct, m, p, `ohr-${m}-${p}`));
      }
    }
    await Promise.all(tasks);
  } else if (mode === "hals") {
    const halsProduct = await findBySku(HALS_SKU);
    const models = ["sophia", "claire", "jen", "amara"];
    for (const m of models) {
      await renderOne(halsProduct, m, "frontal", `hals-${m}-frontal`);
    }
  }
  console.log("done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
