// Rein lesender Audit: wie viele Produkte haben assignedModelKey=null, UND wessen zuletzt
// generierte Bilder (handPreset) ein ANDERES Model zeigen als assignModel() heute liefern würde -
// genau das Muster, das bei 4L938W8 fast zu einer stillen Fehlzuordnung geführt hätte (manuelle
// Modellwahl über den ModelPickerModal, die assignModel()'s Kategorie-Default nicht kennt).
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { isNull, eq } from "drizzle-orm";
import { assignModel, MARINELL_MODELS } from "@/lib/image-facts";

function modelNameToKey(name: string): string | null {
  const entry = Object.entries(MARINELL_MODELS).find(([, m]) => m.name === name);
  return entry ? entry[0] : null;
}

async function main() {
  const nullProducts = await db.query.sourceProducts.findMany({
    where: isNull(sourceProducts.assignedModelKey),
  });
  console.log(`${nullProducts.length} Produkte mit assignedModelKey=null.\n`);

  let mismatchCount = 0;
  let noImagesCount = 0;
  let matchCount = 0;

  for (const product of nullProducts) {
    const images = await db.query.productGeneratedImages.findMany({
      where: eq(productGeneratedImages.sourceProductId, product.id),
    });
    if (images.length === 0) {
      noImagesCount++;
      continue;
    }
    // Modelname aus dem handPreset extrahieren (Format: "<Name> – <Pose>[ (Compositing)]")
    const usedNames = new Set(
      images
        .map((img) => img.handPreset?.split(" – ")[0]?.trim())
        .filter((n): n is string => Boolean(n)),
    );
    const wouldAssign = assignModel(product);
    const wouldAssignName = MARINELL_MODELS[wouldAssign].name;

    const usedKeys = new Set([...usedNames].map(modelNameToKey).filter(Boolean));
    const isMismatch = usedKeys.size > 0 && !usedKeys.has(wouldAssign);

    if (isMismatch) {
      mismatchCount++;
      console.log(
        `MISMATCH: id=${product.id} sku=${product.modellErweitert} kategorie=${product.hauptkategorie} ` +
          `-> bisher generiert mit [${[...usedNames].join(", ")}], assignModel() würde heute "${wouldAssignName}" liefern`,
      );
    } else {
      matchCount++;
    }
  }

  console.log(`\nZusammenfassung: ${mismatchCount} echte Mismatches, ${matchCount} unauffällig (passt/keine Historie), ${noImagesCount} ohne generierte Bilder.`);
}

main().then(() => process.exit(0));
