// Prüft, ob heute (nach dem 05:01-Uhr-Sync, vor dem Code-Fix) noch ANDERE Produkte als 4L938W8 per
// "Neu generieren" den assignedModelKey-Bug getroffen haben - also Bilder mit generatedAt seit
// 05:00 UTC heute, deren handPreset-Model vom historisch etablierten Model abweicht.
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { gte } from "drizzle-orm";
import { modelKeyByName } from "@/lib/image-facts";

async function main() {
  const todayStart = new Date("2026-08-27T05:00:00.000Z");
  const recentImages = await db.query.productGeneratedImages.findMany({
    where: gte(productGeneratedImages.generatedAt, todayStart),
  });
  console.log(`${recentImages.length} Bilder seit ${todayStart.toISOString()} generiert.\n`);

  const byProduct = new Map<number, typeof recentImages>();
  for (const img of recentImages) {
    const arr = byProduct.get(img.sourceProductId) ?? [];
    arr.push(img);
    byProduct.set(img.sourceProductId, arr);
  }

  for (const [productId, imgs] of byProduct) {
    const product = await db.query.sourceProducts.findFirst({ where: (sp, { eq }) => eq(sp.id, productId) });
    const allImages = await db.query.productGeneratedImages.findMany({
      where: (pgi, { eq }) => eq(pgi.sourceProductId, productId),
    });
    const olderImages = allImages.filter((i) => !imgs.some((r) => r.id === i.id));
    const historicalKeys = new Set(
      olderImages.map((i) => modelKeyByName(i.handPreset?.split(" – ")[0]?.trim() ?? "")).filter((k) => k !== null),
    );
    const todayKeys = new Set(
      imgs.map((i) => modelKeyByName(i.handPreset?.split(" – ")[0]?.trim() ?? "")).filter((k) => k !== null),
    );
    console.log({
      productId,
      sku: product?.modellErweitert,
      currentAssignedModelKey: product?.assignedModelKey,
      todaysImageIds: imgs.map((i) => i.id),
      todaysModels: [...todayKeys],
      priorModelsFromOlderImages: [...historicalKeys],
      mismatch: historicalKeys.size > 0 && ![...todayKeys].every((k) => historicalKeys.has(k)),
    });
  }
}
main().then(() => process.exit(0));
