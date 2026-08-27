// Regressionscheck nach dem Chain-first-Umbau (2026-08-27): OHNE OPENAI_API_KEY laufen lassen, damit
// compositeJewelryVariant() beim Kein-Ketten-Fallback bleibt (preparePendantAsset/computePastePosition/
// pastePendantOnto statt der alten monolithischen compositeRaw()-Implementierung) - prüft, dass der
// bereits gebilligte reine Bildmathematik-Pfad nach dem Refactor noch exakt so funktioniert.
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compositeJewelryVariant } from "@/lib/image-compositing";
import { MARINELL_MODELS, POSE_VARIANTS } from "@/lib/image-facts";
import fs from "node:fs/promises";

async function main() {
  delete process.env.OPENAI_API_KEY;
  const OUT_DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/0a3ffc0b-79fe-414c-8af5-f3583a784174/scratchpad/regress";

  for (const sku of ["4P765G8", "4R267R8", "4L938W8"]) {
    const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, sku) });
    if (!product) { console.log(sku, "NICHT GEFUNDEN"); continue; }
    const model = MARINELL_MODELS[(product.assignedModelKey as keyof typeof MARINELL_MODELS) ?? "sophia"];
    const pose = POSE_VARIANTS[0];
    const { buffer, prompt } = await compositeJewelryVariant(product, model, pose, 99);
    const outPath = `${OUT_DIR}/${sku}-${pose.key}.png`;
    await fs.writeFile(outPath, buffer);
    console.log(sku, "->", outPath, "|", prompt);
  }
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
