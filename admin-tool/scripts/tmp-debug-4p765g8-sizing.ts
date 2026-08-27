import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compositeJewelryVariant } from "@/lib/image-compositing";
import { MARINELL_MODELS, POSE_VARIANTS } from "@/lib/image-facts";
import fs from "node:fs/promises";

async function main() {
  // Absichtlich OHNE OPENAI_API_KEY laufen lassen, damit compositeJewelryVariant() laut eigenem
  // Code-Pfad (`if (!calibration.chainLeftAnchor || ... || !apiKey) return pendantOnly`) NUR den
  // deterministischen Bildmathematik-Schritt (compositeRaw) ausführt und den riskanten KI-
  // Kettenschritt (generateChainViaMask) überspringt - isoliert damit, ob das Größenproblem schon
  // VOR oder erst durch die KI entsteht.
  delete process.env.OPENAI_API_KEY;

  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.modellErweitert, "4P765G8"),
  });
  if (!product) throw new Error("Produkt nicht gefunden");

  const model = MARINELL_MODELS.sophia;
  for (const poseKey of ["frontal", "dreiviertelprofil"]) {
    const pose = POSE_VARIANTS.find((p) => p.key === poseKey)!;
    const { buffer, prompt } = await compositeJewelryVariant(product, model, pose, 99);
    const outPath = `/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/d29a402b-f4c1-4e45-89c9-adfcf92db3cb/scratchpad/4p765g8/debug-pendant-only-${poseKey}.png`;
    await fs.writeFile(outPath, buffer);
    console.log(poseKey, "->", outPath, "|", prompt);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
