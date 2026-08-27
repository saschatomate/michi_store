// Testet den Chain-first-Umbau + Anker-Platzhalter (2026-08-27) an einem kleinen (4L938W8, bisher
// zuverlässig scheiternd) UND einem großen, bereits gebilligten Motiv (4R267R8, 11mm-Referenzfall) -
// schreibt NUR lokale Dateien, rührt weder DB noch Storage an.
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compositeJewelryVariant } from "@/lib/image-compositing";
import { MARINELL_MODELS, POSE_VARIANTS } from "@/lib/image-facts";
import fs from "node:fs/promises";

const OUT_DIR =
  "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/0a3ffc0b-79fe-414c-8af5-f3583a784174/scratchpad/anchor-test";

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const cases: { sku: string; poseKey: string }[] = [
    { sku: "4L938W8", poseKey: "frontal" },
    { sku: "4R267R8", poseKey: "dreiviertelprofil" },
  ];

  for (const { sku, poseKey } of cases) {
    const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, sku) });
    if (!product) { console.log(sku, "NICHT GEFUNDEN"); continue; }
    const model = MARINELL_MODELS[(product.assignedModelKey as keyof typeof MARINELL_MODELS) ?? "sophia"];
    const pose = POSE_VARIANTS.find((p) => p.key === poseKey)!;
    console.log(`--- ${sku} / ${model.key} / ${poseKey} ---`);
    process.env.DEBUG_CHAIN_DUMP_DIR = `/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/0a3ffc0b-79fe-414c-8af5-f3583a784174/scratchpad/terminus-${sku.toLowerCase()}`;
    const { buffer, prompt } = await compositeJewelryVariant(product, model, pose, 999);
    const outPath = `${OUT_DIR}/${sku}-${poseKey}.png`;
    await fs.writeFile(outPath, buffer);
    console.log(sku, "->", outPath, "|", prompt);
  }
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
