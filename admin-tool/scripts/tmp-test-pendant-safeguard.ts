import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compositeJewelryVariant } from "@/lib/image-compositing";
import { MARINELL_MODELS, POSE_VARIANTS } from "@/lib/image-facts";
import fs from "node:fs/promises";

async function main() {
  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.modellErweitert, "4P765G8"),
  });
  if (!product) throw new Error("Produkt nicht gefunden");

  const model = MARINELL_MODELS.sophia;
  const poseKey = process.argv[2] ?? "dreiviertelprofil";
  const pose = POSE_VARIANTS.find((p) => p.key === poseKey)!;
  console.log(`Teste ${poseKey}...`);
  const { buffer, prompt } = await compositeJewelryVariant(product, model, pose, 999);
  const outPath = `/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/d29a402b-f4c1-4e45-89c9-adfcf92db3cb/scratchpad/4p765g8/safeguard-test-${poseKey}.png`;
  await fs.writeFile(outPath, buffer);
  console.log(poseKey, "->", outPath, "|", prompt);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
