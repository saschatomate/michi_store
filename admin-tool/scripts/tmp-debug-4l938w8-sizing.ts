import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compositeJewelryVariant } from "@/lib/image-compositing";
import { MARINELL_MODELS, POSE_VARIANTS } from "@/lib/image-facts";
import fs from "node:fs/promises";

async function main() {
  // Ohne OPENAI_API_KEY -> nur der deterministische Bildmathematik-Schritt, kein KI-Kettenaufruf,
  // kostenlos - isoliert die reine Größenwirkung des MAX_RENDER_ENLARGEMENT_RATIO-Fixes.
  delete process.env.OPENAI_API_KEY;

  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.modellErweitert, "4L938W8"),
  });
  if (!product) throw new Error("Produkt nicht gefunden");

  const model = MARINELL_MODELS.jen;
  const pose = POSE_VARIANTS.find((p) => p.key === "frontal")!;
  const { buffer, prompt } = await compositeJewelryVariant(product, model, pose, 999);
  const outPath =
    "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/d29a402b-f4c1-4e45-89c9-adfcf92db3cb/scratchpad/4l938w8/after-fix-pendant-only.png";
  await fs.writeFile(outPath, buffer);
  console.log("->", outPath, "|", prompt);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
