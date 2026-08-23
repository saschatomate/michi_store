import "server-only";
import sharp from "sharp";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import type { MarinellModel, PoseVariant } from "@/lib/image-facts";
import { motifSizeMm, referenceImageUrl, fetchImageBuffer } from "@/lib/image-generation";
import { estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";

type SourceProductRow = typeof sourceProducts.$inferSelect;

const OPENAI_IMAGE_MODEL = "gpt-image-1.5";

// --- MARINELL Compositing-Pfad (Beta) ---------------------------------------------------------
// Zweiter, unabhängiger Generierungsweg NEBEN generateProductImageVariant() (image-generation.ts) -
// der klassische Weg bleibt vollständig bestehen und ist weiterhin der Standard. Hintergrund: über
// mehrere Testrunden (mm-Vergleich, %-Bildbreite, input_fidelity=low, Maßstabskarte als drittes
// Bild) hat sich gezeigt, dass gpt-image-1.5 im Edit-Modus Text-Größenvorgaben bei sehr kleinen
// Schmuckstücken (<15mm) nicht zuverlässig befolgt - es orientiert sich stärker an der visuellen
// Prominenz des Produktfotos selbst. Dieser Pfad umgeht das Problem, indem die Größe NICHT der KI
// überlassen wird: das Produktfoto wird rechnerisch korrekt auf ein festes, wiederverwendetes
// "leeres" Model-Foto montiert (reine Bildmathematik über sharp), und die KI wird nur noch für
// einen eng eingegrenzten Nachbearbeitungsschritt (Licht/Schatten/Kontaktschatten) eingesetzt, bei
// dem sie explizit angewiesen wird, Größe/Position NICHT zu verändern - das hat sich im Test
// (Produkt 4R267R8) als zuverlässig herausgestellt (Ergebnis vor/nach der KI-Politur pixelgleich
// in der Größe).
//
// Deutliche Einschränkung, Stand jetzt: nur EINE Model/Pose/Kategorie-Kombination ist kalibriert
// (Sophia, Frontal, Colliers/Anhänger). Für alle anderen Kombinationen wirft
// compositeJewelryVariant() einen Fehler - der Aufrufer muss auf den klassischen Weg zurückfallen
// oder die Option in der UI deaktivieren (siehe hasCompositingSupport()). Jede weitere Kombination
// braucht ein eigenes, einmalig generiertes und kalibriertes Basis-Foto (siehe PoseCalibration).

export type PoseCalibration = {
  /** Festes, wiederverwendetes Foto des Models in dieser Pose, OHNE jeglichen Schmuck. */
  baseImageUrl: string;
  /** Ankerpunkt (Mittelpunkt der Platzierung) als Prozent der Bildbreite/-höhe. */
  anchorXPercent: number;
  anchorYPercent: number;
  /**
   * Pixel pro mm IM BASISFOTO, ermittelt über eine verlässliche Anatomie-Konstante (hier:
   * Pupillenabstand, Ø 63mm beim Erwachsenen) statt einer groben Kategorie-Schätzung - lässt sich
   * am fertigen Foto direkt nachmessen und ist deutlich präziser als BodyPartMapping.
   * estimatedFrameWidthMm aus image-facts.ts (das war der Ansatz für den klassischen Prompt-Weg).
   */
  pxPerMm: number;
};

// Schlüssel: `${modelKey}:${poseKey}:${kategorieBucket}`. Colliers/Anhänger und Armbänder/
// Armreifen teilen sich bewusst denselben Bucket (gleiche Körperpartie/Rahmung), analog zu
// estimatedFrameWidthMm in image-facts.ts.
export const POSE_CALIBRATIONS: Record<string, PoseCalibration> = {
  "sophia:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-hals.png",
    anchorXPercent: 50,
    anchorYPercent: 64,
    pxPerMm: 2.76,
  },
};

function categoryBucket(hauptkategorie: string | null): string | null {
  if (!hauptkategorie) return null;
  if (hauptkategorie === "Anhänger") return "Colliers";
  if (hauptkategorie === "Armreifen") return "Armbänder";
  return hauptkategorie;
}

function calibrationKey(modelKey: string, poseKey: string, hauptkategorie: string | null): string | null {
  const bucket = categoryBucket(hauptkategorie);
  if (!bucket) return null;
  return `${modelKey}:${poseKey}:${bucket}`;
}

export function findCalibration(
  modelKey: string,
  poseKey: string,
  hauptkategorie: string | null,
): PoseCalibration | null {
  const key = calibrationKey(modelKey, poseKey, hauptkategorie);
  return key ? (POSE_CALIBRATIONS[key] ?? null) : null;
}

export function hasCompositingSupport(
  modelKey: string,
  hauptkategorie: string | null,
): boolean {
  // "Unterstützt" heißt hier: für mindestens eine Pose dieses Models+dieser Kategorie existiert
  // eine Kalibrierung - reicht als Kriterium, um die Option in der UI überhaupt anzubieten (die
  // konkrete Pose wird erst beim eigentlichen Generieren pro Variante geprüft).
  const bucket = categoryBucket(hauptkategorie);
  if (!bucket) return false;
  return Object.keys(POSE_CALIBRATIONS).some((k) => k.startsWith(`${modelKey}:`) && k.endsWith(`:${bucket}`));
}

// Ermittelt die Pixel-Bounding-Box des tatsächlichen Motivs in einem freigestellten Produktfoto
// über den Alpha-Kanal (sharp trim()). Funktioniert zuverlässig bei echten transparenten Cutouts.
// Manche Freisteller-Fotos haben aber einen deckenden (nicht-transparenten) Studio-Hintergrund
// innerhalb der Canvas, nur der äußerste Rand ist transparent (bei Produkt 4R267R8 beobachtet) -
// dort verkleinert trim() das Bild kaum, und das Ergebnis wäre falsch (Hintergrund statt Motiv).
// Schrumpft die Bounding Box um weniger als 10% in eine Richtung, geben wir bewusst null zurück,
// statt ein falsches Ergebnis zu riskieren - der Aufrufer muss dann motifCropOverride nutzen.
export async function detectMotifBoundingBox(
  buffer: Buffer,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const original = await sharp(buffer).metadata();
  const { info } = await sharp(buffer).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
  const shrunkEnough =
    info.width < (original.width ?? Infinity) * 0.9 || info.height < (original.height ?? Infinity) * 0.9;
  if (!shrunkEnough) return null;
  return {
    left: info.trimOffsetLeft ? -info.trimOffsetLeft : 0,
    top: info.trimOffsetTop ? -info.trimOffsetTop : 0,
    width: info.width,
    height: info.height,
  };
}

export type MotifCropOverride = { left: number; top: number; width: number; height: number };

// Manuelle Motiv-Ausschnitte für Produkte, bei denen detectMotifBoundingBox() nicht zuverlässig
// funktioniert (deckender Studio-Hintergrund statt echter Transparenz, siehe dort). Schlüssel:
// modellErweitert. 4R267R8 wurde einmalig über ein Prozent-Grid-Overlay auf dem 2000x2000-Foto
// ausgemessen (Cluster ca. x:42-69%, y:55-87%). Jedes weitere Produkt mit demselben Freisteller-
// Stil braucht vorerst denselben manuellen Schritt, bis eine robustere automatische Erkennung
// (z.B. über eine Vision-API statt reinem Alpha-Trim) existiert.
const PRODUCT_MOTIF_OVERRIDES: Record<string, MotifCropOverride> = {
  "4R267R8": { left: 840, top: 1100, width: 540, height: 640 },
};

async function resolveMotifCrop(
  product: SourceProductRow,
  productBuffer: Buffer,
): Promise<MotifCropOverride> {
  const override = PRODUCT_MOTIF_OVERRIDES[product.modellErweitert];
  if (override) return override;
  const detected = await detectMotifBoundingBox(productBuffer);
  if (detected) return detected;
  throw new Error(
    `Motiv-Bereich für ${product.modellErweitert} konnte nicht automatisch erkannt werden ` +
      `(vermutlich kein echter transparenter Freisteller-Hintergrund) und ist auch nicht in ` +
      `PRODUCT_MOTIF_OVERRIDES manuell hinterlegt - Compositing-Weg für dieses Produkt noch nicht möglich.`,
  );
}

// Reine Bildmathematik (keine KI): schneidet den Motiv-Bereich aus dem Produktfoto, skaliert ihn
// anhand der bekannten Realgröße (motifMm, aus breite/höhe der Produktdaten) exakt auf den
// Maßstab des Basisfotos (calibration.pxPerMm) und setzt ihn zentriert auf den Ankerpunkt.
export async function compositeRaw(
  baseBuffer: Buffer,
  productBuffer: Buffer,
  motifMm: number,
  motifCrop: MotifCropOverride,
  calibration: PoseCalibration,
): Promise<Buffer> {
  const baseMeta = await sharp(baseBuffer).metadata();
  const baseW = baseMeta.width!;
  const baseH = baseMeta.height!;

  const cropped = await sharp(productBuffer).extract(motifCrop).png().toBuffer();

  // Skalierungsfaktor: wie viel kleiner/größer muss der Ausschnitt werden, damit seine LÄNGERE
  // Seite im Zielfoto motifMm * calibration.pxPerMm Pixel misst (motifMm bezieht sich auf die
  // größere reale Abmessung, siehe motifSizeMm() in image-generation.ts).
  const cropLongerPx = Math.max(motifCrop.width, motifCrop.height);
  const targetLongerPx = motifMm * calibration.pxPerMm;
  const scaleFactor = targetLongerPx / cropLongerPx;
  const targetW = Math.max(1, Math.round(motifCrop.width * scaleFactor));
  const targetH = Math.max(1, Math.round(motifCrop.height * scaleFactor));
  const resized = await sharp(cropped).resize(targetW, targetH).png().toBuffer();

  const anchorX = Math.round((calibration.anchorXPercent / 100) * baseW);
  const anchorY = Math.round((calibration.anchorYPercent / 100) * baseH);
  const pasteLeft = Math.round(anchorX - targetW / 2);
  const pasteTop = Math.round(anchorY - targetH / 2);

  return sharp(baseBuffer)
    .composite([{ input: resized, left: pasteLeft, top: pasteTop }])
    .png()
    .toBuffer();
}

// Einziger KI-Aufruf in diesem Pfad: passt NUR Licht/Schatten/Kontaktschatten des bereits fertig
// (und korrekt skaliert) zusammengesetzten Fotos an, mit expliziter Anweisung, Größe/Position NICHT
// zu verändern. input_fidelity bewusst "high", damit das Composite so treu wie möglich erhalten
// bleibt (Gegenteil des Problems beim klassischen Weg: dort war "high" das Problem, weil es das
// Produktfoto zu wörtlich als Größenvorlage genommen hat - hier ist "wörtlich übernehmen" genau
// das Ziel, wir wollen ja NUR die Beleuchtung ändern).
async function harmonizeComposite(
  compositeBuffer: Buffer,
  apiKey: string,
): Promise<{ buffer: Buffer; usage: unknown }> {
  const prompt =
    "Dies ist ein bereits fertig zusammengesetztes Foto: ein Schmuckstück wurde bereits in exakt " +
    "korrekter Größe und Position auf dieses Foto montiert. KRITISCH: Verändere die GRÖSSE, " +
    "POSITION, FORM oder das DESIGN des Schmuckstücks NICHT im geringsten - Größe und Platzierung " +
    "sind bereits exakt korrekt und dürfen unter keinen Umständen angepasst werden. Deine EINZIGE " +
    "Aufgabe: passe NUR Licht, Schatten, Reflexionen und Farbtemperatur des Schmuckstücks fein an " +
    "die Szene an, damit es fotorealistisch auf der Haut aufliegt statt wie eingefügt zu wirken - " +
    "ein feiner Kontaktschatten, warmes Licht passend zur Szenenbeleuchtung auf Metall/Steinen. " +
    "Gesicht, Haare, Kleidung, Hintergrund, Pose und Bildausschnitt bleiben zu 100% unverändert.";

  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const file = await toFile(compositeBuffer, "composite", { type: "image/png" });
  const response = await client.images.edit({
    image: [file],
    prompt,
    model: OPENAI_IMAGE_MODEL,
    size: "1024x1536",
    quality: "high",
    input_fidelity: "high",
    output_format: "png",
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Harmonisierungs-Aufruf hat kein Bild zurückgegeben.");
  return { buffer: Buffer.from(b64, "base64"), usage: response.usage };
}

// Pendant zu generateProductImageVariant() (image-generation.ts) - gleicher Rückgabewert
// ({buffer, prompt}), damit beide Wege austauschbar von image-actions.ts aufgerufen werden können.
// "prompt" enthält hier nur den Harmonisierungs-Prompt (zu Audit-/Anzeige-Zwecken) - es gibt keinen
// eigentlichen Bild-Generierungs-Prompt, die Platzierung ist reine Mathematik.
//
export async function compositeJewelryVariant(
  product: SourceProductRow,
  model: MarinellModel,
  poseVariant: PoseVariant,
  variantIndex: number,
): Promise<{ buffer: Buffer; prompt: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ist nicht gesetzt (.env.local prüfen).");

  const calibration = findCalibration(model.key, poseVariant.key, product.hauptkategorie);
  if (!calibration) {
    throw new Error(
      `Kein kalibriertes Basis-Foto für ${model.key}/${poseVariant.key}/${product.hauptkategorie ?? "?"} ` +
        `- Compositing-Weg ist für diese Kombination noch nicht verfügbar.`,
    );
  }

  const motifMm = motifSizeMm(product);
  if (!motifMm) {
    throw new Error("Produkt hat keine gepflegte Breite/Höhe - Compositing benötigt echte Maße.");
  }

  const refUrl = referenceImageUrl(product);
  if (!refUrl) throw new Error("Kein Referenzfoto für dieses Produkt vorhanden.");

  const [baseBuffer, productBuffer] = await Promise.all([
    fetchImageBuffer(calibration.baseImageUrl),
    fetchImageBuffer(refUrl),
  ]);

  const motifCrop = await resolveMotifCrop(product, productBuffer);
  const rawComposite = await compositeRaw(baseBuffer, productBuffer, motifMm, motifCrop, calibration);
  const { buffer: harmonized, usage } = await harmonizeComposite(rawComposite, apiKey);

  await recordApiUsage({
    provider: "openai",
    purpose: "image_generation",
    sourceProductId: product.id,
    variantIndex,
    model: OPENAI_IMAGE_MODEL,
    usage,
    costUsd: estimateOpenAiImageCost(OPENAI_IMAGE_MODEL, usage as Parameters<typeof estimateOpenAiImageCost>[1]),
  });

  return {
    buffer: harmonized,
    prompt: `[Compositing-Weg: mathematisch platziert, dann KI-Lichtanpassung] ${model.name} - ${poseVariant.label}`,
  };
}
