// Regeneriert gezielt product_generated_images.id=135 (4P765G8, Sophia, Dreiviertelprofil,
// Compositing) mit dem neuen Vision-Safeguard - repliziert generateAndSaveVariant() aus
// image-actions.ts 1:1 (inkl. C2PA-Signatur, Storage-Upload, Löschen des alten Storage-Objekts),
// nur OHNE requireAuth() (reiner Session-Cookie-Gate, keine Businesslogik, in einem Script ohne
// Next.js-Request-Kontext nicht aufrufbar - siehe next/navigation redirect()).
import { eq } from "drizzle-orm";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages } from "@/db/schema";
import { compositeJewelryVariant } from "@/lib/image-compositing";
import { uploadGeneratedImage, deleteGeneratedImage } from "@/lib/image-storage";
import { MARINELL_MODELS, POSE_VARIANTS, assignModel } from "@/lib/image-facts";

// Inline statt import { signGeneratedImage } from "@/lib/c2pa-sign": ein statischer Import dieses
// Moduls scheitert unter tsx an sign-ai-media (rein ESM-only "exports"-Feld, wird über den
// gemischten CJS/ESM-Ladepfad hier fälschlich per CJS-require aufgelöst) - ein dynamic import()
// derselben Funktionen funktioniert nachweislich problemlos, siehe c2pa-sign.ts für das Original.
async function signGeneratedImage(imageBuffer: Buffer, prompt: string): Promise<Buffer> {
  const { signAiGeneratedMedia, resolveDigitalSourceType } = await import("sign-ai-media");
  const dir = await mkdtemp(join(tmpdir(), "marinell-c2pa-"));
  const inputPath = join(dir, "input.png");
  const outputPath = join(dir, "output.png");
  try {
    await writeFile(inputPath, imageBuffer);
    await signAiGeneratedMedia({
      input: inputPath,
      output: outputPath,
      metadata: {
        softwareAgent: "Marinell Admin-Tool Bildgenerierung",
        generator: "OpenAI GPT Image API (gpt-image-1.5)",
        model: "gpt-image-1.5",
        producer: "Marinell",
        prompt,
        digitalSourceType: resolveDigitalSourceType("ai-edited"),
        actionDescription: "Echtes Produktfoto mit KI-generierter Umgebung kompositiert",
      },
    });
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const IMAGE_ID = 135;
  const existing = await db.query.productGeneratedImages.findFirst({
    where: eq(productGeneratedImages.id, IMAGE_ID),
  });
  if (!existing) throw new Error(`Bild ${IMAGE_ID} nicht gefunden.`);
  if (existing.status === "approved") {
    throw new Error("Bild ist bereits freigegeben - breche ab (gleiche Regel wie generateAndSaveVariant()).");
  }

  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.id, existing.sourceProductId),
  });
  if (!product) throw new Error("Produkt nicht gefunden.");
  // assignedModelKey ist inzwischen (irgendwann zwischen der letzten Session und heute) auf null
  // zurückgefallen - vermutlich ein Nebeneffekt eines zwischenzeitlichen Katalog-Reimports (siehe
  // [[marinell-ftp-sync]]/[[marinell-product13-data-loss]]-Muster). assignModel() ist eine reine
  // Funktion rein deterministischer Produktfelder (GIA-Zertifikat, Karat, Hauptkategorie) - für
  // 4P765G8 (Colliers, kein GIA-Zertifikat) liefert eine Neuableitung garantiert wieder "sophia",
  // exakt wie resolveAndPersistModel() in image-actions.ts es bei einem echten Aufruf auch täte.
  let assignedModelKey = product.assignedModelKey;
  if (!assignedModelKey) {
    assignedModelKey = assignModel(product);
    await db.update(sourceProducts).set({ assignedModelKey }).where(eq(sourceProducts.id, product.id));
    console.log(`assignedModelKey war null, neu abgeleitet und persistiert: ${assignedModelKey}`);
  }

  const model = MARINELL_MODELS[assignedModelKey as keyof typeof MARINELL_MODELS];
  const poseVariant = POSE_VARIANTS[existing.variantIndex] ?? POSE_VARIANTS[0];
  const label = `${model.name} – ${poseVariant.label} (Compositing)`;

  console.log(`Regeneriere Bild ${IMAGE_ID}: ${product.modellErweitert}, ${label}...`);
  const { buffer, prompt } = await compositeJewelryVariant(product, model, poseVariant, existing.variantIndex);
  console.log("compositeJewelryVariant fertig:", prompt);

  const signed = await signGeneratedImage(buffer, prompt);
  const path = `generated/${product.id}/${existing.variantIndex}-${Date.now()}.png`;
  const { url } = await uploadGeneratedImage(signed, path);
  console.log("Hochgeladen:", url);

  if (existing.storagePath) {
    await deleteGeneratedImage(existing.storagePath).catch((err) => {
      console.warn("Altes Storage-Objekt konnte nicht gelöscht werden (nicht kritisch):", err);
    });
  }

  await db
    .update(productGeneratedImages)
    .set({
      handPreset: label,
      imageUrl: url,
      storagePath: path,
      status: "pending_review",
      approvedAt: null,
      generatedAt: new Date(),
      generationError: null,
    })
    .where(eq(productGeneratedImages.id, existing.id));

  console.log(`Fertig. Bild ${IMAGE_ID} aktualisiert.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
