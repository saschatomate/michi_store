import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import type { MarinellModel, PoseVariant } from "@/lib/image-facts";
import { motifSizeMm, referenceImageUrl, fetchImageBuffer } from "@/lib/image-generation";

type SourceProductRow = typeof sourceProducts.$inferSelect;

const OPENAI_IMAGE_MODEL = "gpt-image-1.5";

// BEWUSST dynamischer Import statt "import sharp from 'sharp'" oben: ein statischer Top-Level-
// Import hätte sharp bei JEDEM Laden dieses Moduls sofort ausgewertet - und damit bei JEDEM Aufruf
// von hasCompositingSupport()/findCalibration() (aufgerufen von products/[id]/page.tsx, also bei
// JEDER Produktseite, nicht nur beim tatsächlichen Compositing). Ein Sharp-Ladefehler (z.B.
// Turbopack-Bundling der nativen Bindings, siehe next.config.ts serverExternalPackages, oder ein
// Plattform-Problem auf dem Deployment-Server) hätte dadurch die komplette Produktseite für ALLE
// Produkte mit Internal Server Error abgeschossen - genau das ist einmal live passiert. Mit
// dynamischem Import schlägt ein Sharp-Problem nur noch dort fehl, wo Compositing tatsächlich
// ausgeführt wird (detectMotifBoundingBox/compositeRaw), nicht beim bloßen Anzeigen einer Seite.
async function loadSharp() {
  const mod = await import("sharp");
  return mod.default;
}

// --- MARINELL Compositing-Pfad (Beta) ---------------------------------------------------------
// Zweiter, unabhängiger Generierungsweg NEBEN generateProductImageVariant() (image-generation.ts) -
// der klassische Weg bleibt vollständig bestehen und ist weiterhin der Standard. Hintergrund: über
// mehrere Testrunden (mm-Vergleich, %-Bildbreite, input_fidelity=low, Maßstabskarte als drittes
// Bild) hat sich gezeigt, dass gpt-image-1.5 im Edit-Modus Text-Größenvorgaben bei sehr kleinen
// Schmuckstücken (<15mm) nicht zuverlässig befolgt - es orientiert sich stärker an der visuellen
// Prominenz des Produktfotos selbst. Dieser Pfad umgeht das Problem, indem die Größe NICHT der KI
// überlassen wird: das Produktfoto wird rechnerisch korrekt auf ein festes, wiederverwendetes
// "leeres" Model-Foto montiert (reine Bildmathematik über sharp) - keine KI-Generierung mehr nötig.
//
// Ursprünglich gab es hier zusätzlich einen KI-Politur-Schritt (nur Licht/Schatten anpassen). Der
// ist seit 2026-08-23 ABGESCHALTET (siehe Kommentar bei harmonizeComposite): bei 4R267R8 hat gpt-
// image-1.5 dabei trotz strikter "Design nicht verändern"-Anweisung das kaum lesbare, nur ~30px
// große Motiv neu interpretiert - aus 3 Steinen wurde ein unklarer Blob, die Kette teils entfernt.
// Der reine Mathematik-Composite (ohne diesen Schritt) ist dagegen korrekt, nur naturgemäß etwas
// weich. compositeJewelryVariant() liefert daher aktuell den rohen Composite direkt - dadurch ist
// dieser Pfad komplett kostenlos (keine OpenAI-Aufrufe mehr), bis ein zuverlässigerer
// Politur-Ansatz gefunden ist.
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
  /**
   * Rotation in Grad (sharp-Konvention, positiv = im Uhrzeigersinn), mit der der eingefügte
   * Ausschnitt gedreht wird, bevor er auf den Ankerpunkt gesetzt wird - Zwischenschritt, um die
   * Kette grob an den Hals-/Schulterwinkel dieser Pose anzupassen. Bewusst nur eine grobe erste
   * Schätzung (Fund 2026-08-23: die Kette lag ohne jede Drehung sichtbar "drüber" statt "dran"
   * bei Dreiviertelprofil/Seitlich). Physikalisch nicht ganz korrekt, weil dabei auch der Anhänger
   * mitgedreht wird, obwohl ein echter Anhänger durch die Schwerkraft eher aufrecht hängen bleibt,
   * unabhängig vom Kopfwinkel - siehe Kommentar bei compositeRaw(). Fehlt/0 = keine Drehung.
   */
  rotationDeg?: number;
};

// Schlüssel: `${modelKey}:${poseKey}:${kategorieBucket}`. Colliers/Anhänger und Armbänder/
// Armreifen teilen sich bewusst denselben Bucket (gleiche Körperpartie/Rahmung), analog zu
// estimatedFrameWidthMm in image-facts.ts.
// pxPerMm bewusst für alle 3 Sophia-Hals-Posen identisch (2.76, aus dem Pupillenabstand im
// Frontal-Foto) statt pro Foto neu über die Pupillen gemessen - bei Dreiviertelprofil/Seitlich
// verzerrt die Kopfdrehung den scheinbaren Pupillenabstand perspektivisch (zu klein), eine direkte
// Neumessung dort würde das Motiv fälschlich verkleinern. Kopf-/Bildausschnittgröße ist in allen 3
// Fotos (gleicher Prompt-Rahmen) sichtbar konsistent, daher ist die Wiederverwendung die
// verlässlichere Annahme.
export const POSE_CALIBRATIONS: Record<string, PoseCalibration> = {
  "sophia:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-hals.png",
    anchorXPercent: 50,
    anchorYPercent: 64,
    pxPerMm: 2.76,
  },
  "sophia:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-hals.png",
    anchorXPercent: 52,
    anchorYPercent: 63,
    pxPerMm: 2.76,
    // Erste grobe Schätzung (nicht ausgemessen) - Zwischenschritt auf Nutzerwunsch, um zu sehen,
    // ob Richtung/Größenordnung überhaupt stimmt, bevor die aufwändigere Lösung (Kette separat
    // prozedural zeichnen statt drehen) gebaut wird. Nach Sichtprüfung anpassen/Vorzeichen drehen.
    rotationDeg: -8,
  },
  "sophia:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-hals.png",
    anchorXPercent: 48,
    anchorYPercent: 62,
    pxPerMm: 2.76,
    // Ebenfalls erste grobe Schätzung, siehe Kommentar oben bei dreiviertelprofil.
    rotationDeg: 12,
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
  const sharp = await loadSharp();
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

// Zwei getrennte Ausschnitte, NICHT derselbe (das war der eigentliche Bug vom 2026-08-23):
// - extractionCrop: was tatsächlich ausgeschnitten, skaliert und eingefügt wird (bei 4R267R8 der
//   BREITE Ausschnitt inkl. Kette).
// - scaleReferenceCrop: welcher TEIL davon dem bekannten Realmaß (motifMm) entspricht (bei
//   4R267R8 NUR der Cluster, ohne Kette). Nur dieser Teil darf für die Umrechnung mm→Pixel
//   herangezogen werden - wird stattdessen (wie im ersten Fix-Versuch fälschlich) die Größe des
//   GESAMTEN extractionCrop als "das sind motifMm" behandelt, kommt ein viel zu kleiner Maßstab
//   heraus (die Kette spannt real deutlich mehr als motifMm auf), und die dünne Kette verschwindet
//   beim Verkleinern komplett - genau das hat der Nutzer bemerkt.
// Wenn beide identisch sind (Normalfall bei echten transparenten Cutouts ohne Kettenanteil im
// Crop), macht das keinen Unterschied.
export type ProductMotifCrops = {
  extractionCrop: MotifCropOverride;
  scaleReferenceCrop: MotifCropOverride;
};

// Manuelle Motiv-Ausschnitte für Produkte, bei denen detectMotifBoundingBox() nicht zuverlässig
// funktioniert (deckender Studio-Hintergrund statt echter Transparenz, siehe dort). Schlüssel:
// modellErweitert. 4R267R8 wurde einmalig über ein Prozent-Grid-Overlay auf dem 2000x2000-Foto
// ausgemessen (Cluster/scaleReferenceCrop ca. x:42-69%, y:55-87%; extractionCrop breiter, damit die
// Kette mit im Bild ist). Jedes weitere Produkt mit demselben Freisteller-Stil braucht vorerst
// denselben manuellen Schritt, bis eine robustere automatische Erkennung existiert.
const PRODUCT_MOTIF_OVERRIDES: Record<string, ProductMotifCrops> = {
  "4R267R8": {
    extractionCrop: { left: 400, top: 0, width: 1200, height: 1800 },
    scaleReferenceCrop: { left: 840, top: 1100, width: 540, height: 640 },
  },
};

async function resolveMotifCrops(
  product: SourceProductRow,
  productBuffer: Buffer,
): Promise<ProductMotifCrops> {
  const override = PRODUCT_MOTIF_OVERRIDES[product.modellErweitert];
  if (override) return override;
  // Ohne manuellen Override sind extraction- und scaleReferenceCrop identisch - die automatisch
  // erkannte Bounding Box ist dann sowohl "was wir ausschneiden" als auch "was motifMm entspricht".
  const detected = await detectMotifBoundingBox(productBuffer);
  if (detected) return { extractionCrop: detected, scaleReferenceCrop: detected };
  throw new Error(
    `Motiv-Bereich für ${product.modellErweitert} konnte nicht automatisch erkannt werden ` +
      `(vermutlich kein echter transparenter Freisteller-Hintergrund) und ist auch nicht in ` +
      `PRODUCT_MOTIF_OVERRIDES manuell hinterlegt - Compositing-Weg für dieses Produkt noch nicht möglich.`,
  );
}

// Sehr kleine Motive (<MIN_RENDER_MM) werden bewusst NICHT auf ihre exakte Realgröße
// herunterskaliert, sondern auf eine Mindestgröße angehoben. Grund (Fund 2026-08-23 bei 4R267R8,
// 11mm-Cluster): in echter 1:1-Größe ist das Motiv auf dem Produktfoto kaum wahrnehmbar, obwohl
// die Darstellung technisch korrekt wäre - echte Schmuck-Kataloge zeigen sehr kleine Stücke aus
// demselben Grund fast immer leicht vergrößert. 17mm ist eine bewusst moderate Untergrenze
// (Erbse/Kirsche) - deutlich näher an der Realität als der klassische KI-Weg (der kleine Stücke
// oft aufs 2-3-fache aufbläst), aber groß genug, um überhaupt als Schmuckstück erkennbar zu sein.
// Nebeneffekt: mehr Zielpixel = weniger Detailverlust beim Verkleinern. Größere/reale Stücke
// (>=17mm, die ohnehin gut lesbar sind) bleiben unverändert in exakter Realgröße.
const MIN_RENDER_MM = 17;

// Reine Bildmathematik (keine KI): schneidet extractionCrop aus dem Produktfoto, skaliert ihn so,
// dass scaleReferenceCrop darin exakt motifMm (ggf. auf MIN_RENDER_MM angehoben) im Maßstab des
// Basisfotos entspricht, und setzt ihn so ein, dass die MITTE von scaleReferenceCrop (nicht die
// Mitte des ganzen extractionCrop, die kann bei einem breiten Ausschnitt deutlich daneben liegen)
// exakt auf dem Ankerpunkt landet.
export async function compositeRaw(
  baseBuffer: Buffer,
  productBuffer: Buffer,
  motifMm: number,
  crops: ProductMotifCrops,
  calibration: PoseCalibration,
): Promise<Buffer> {
  const sharp = await loadSharp();
  const { extractionCrop, scaleReferenceCrop } = crops;
  const baseMeta = await sharp(baseBuffer).metadata();
  const baseW = baseMeta.width!;
  const baseH = baseMeta.height!;

  const cropped = await sharp(productBuffer).extract(extractionCrop).png().toBuffer();

  // Skalierungsfaktor: wie viel kleiner/größer muss extractionCrop werden, damit scaleReferenceCrop
  // darin (dieselbe Bildauflösung, also gleicher Faktor für beide) mit seiner LÄNGEREN Seite
  // effectiveMm * calibration.pxPerMm Pixel misst (motifMm bezieht sich auf die größere reale
  // Abmessung, siehe motifSizeMm() in image-generation.ts; effectiveMm siehe MIN_RENDER_MM oben).
  const effectiveMm = Math.max(motifMm, MIN_RENDER_MM);
  const referenceLongerPx = Math.max(scaleReferenceCrop.width, scaleReferenceCrop.height);
  const targetReferenceLongerPx = effectiveMm * calibration.pxPerMm;
  const scaleFactor = targetReferenceLongerPx / referenceLongerPx;
  const targetW = Math.max(1, Math.round(extractionCrop.width * scaleFactor));
  const targetH = Math.max(1, Math.round(extractionCrop.height * scaleFactor));
  const resized = await sharp(cropped).resize(targetW, targetH).png().toBuffer();

  // Wo landet die Mitte von scaleReferenceCrop innerhalb des jetzt skalierten extractionCrop?
  const refCenterRelX = scaleReferenceCrop.left - extractionCrop.left + scaleReferenceCrop.width / 2;
  const refCenterRelY = scaleReferenceCrop.top - extractionCrop.top + scaleReferenceCrop.height / 2;
  let refCenterInFinalX = (refCenterRelX / extractionCrop.width) * targetW;
  let refCenterInFinalY = (refCenterRelY / extractionCrop.height) * targetH;
  let finalLayer = resized;
  let finalW = targetW;
  let finalH = targetH;

  // Optionale Rotation (siehe rotationDeg-Kommentar bei PoseCalibration) - sharp dreht um die
  // BILDMITTE und vergrößert die Canvas automatisch, damit nichts abgeschnitten wird. Damit der
  // Ankerpunkt trotzdem exakt auf scaleReferenceCrop landet, muss dessen Position mit derselben
  // Rotationsmatrix um die alte Bildmitte mitgedreht und dann auf die neue (größere) Canvas-Mitte
  // bezogen werden - sonst würde die Drehung das Motiv unbemerkt vom Ankerpunkt wegschieben.
  if (calibration.rotationDeg) {
    const rotated = await sharp(resized)
      .rotate(calibration.rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const rad = (calibration.rotationDeg * Math.PI) / 180;
    const dx = refCenterInFinalX - targetW / 2;
    const dy = refCenterInFinalY - targetH / 2;
    const dxRot = dx * Math.cos(rad) - dy * Math.sin(rad);
    const dyRot = dx * Math.sin(rad) + dy * Math.cos(rad);
    finalW = rotated.info.width;
    finalH = rotated.info.height;
    refCenterInFinalX = finalW / 2 + dxRot;
    refCenterInFinalY = finalH / 2 + dyRot;
    finalLayer = rotated.data;
  }

  const anchorX = Math.round((calibration.anchorXPercent / 100) * baseW);
  const anchorY = Math.round((calibration.anchorYPercent / 100) * baseH);
  const pasteLeft = Math.round(anchorX - refCenterInFinalX);
  const pasteTop = Math.round(anchorY - refCenterInFinalY);

  // Weicher Kontaktschatten (reine Bildmathematik, keine KI): Silhouette des Motivs, geschwärzt,
  // etwas nach unten/rechts versetzt (passend zum etablierten "warmes Licht von links oben"-Look,
  // siehe SYSTEM_INSTRUCTIONS_BEFORE_CLOTHING in image-generation.ts) und weichgezeichnet, mit
  // reduzierter Deckkraft. Versatz/Weichzeichnung bewusst proportional zur Motivgröße (nicht fest
  // in Pixeln), damit es bei jeder Größe (17mm-Mindestgröße oder größer) wie ein echter, feiner
  // Schatten wirkt statt wie ein fester Klecks. a=[0,0,0,x] auf RGB heißt "auf Schwarz
  // multiplizieren" (Silhouette einfärben), b=0 addiert nichts dazu; die Alpha-Bande bleibt mit
  // a=1 unverändert, nur zum Schluss per eigenem linear()-Aufruf auf ~35% Deckkraft reduziert.
  const shadowOffset = Math.max(1, Math.round(finalH * 0.05));
  const shadowBlur = Math.max(0.5, finalH * 0.04);
  const shadow = await sharp(finalLayer)
    .ensureAlpha()
    .linear(
      [0, 0, 0, 1],
      [0, 0, 0, 0],
    )
    .blur(shadowBlur)
    .linear([1, 1, 1, 0.35], [0, 0, 0, 0])
    .png()
    .toBuffer();

  return sharp(baseBuffer)
    .composite([
      { input: shadow, left: pasteLeft, top: pasteTop + shadowOffset },
      { input: finalLayer, left: pasteLeft, top: pasteTop },
    ])
    .png()
    .toBuffer();
}

// ABGESCHALTET (Stand jetzt nicht mehr im Pfad aufgerufen) - Fund vom 2026-08-23 bei 4R267R8:
// Der reine Mathematik-Composite (compositeRaw, ohne diesen Schritt) zeigt das Motiv korrekt -
// alle 3 Steine, die Akzent-Diamanten und die Kette sind sauber erkennbar, nur naturgemäß etwas
// weich (das Cluster ist bei Realgröße nur ~30px groß). Dieser KI-Politur-Schritt sollte NUR Licht/
// Schatten anpassen, hat aber bei diesem winzigen, dadurch für die KI ambigen Motiv stattdessen das
// halbe Design neu erfunden (3 Steine wurden zu einem unklaren Blob, die Kette teilweise entfernt)
// - trotz expliziter "Größe/Design NICHT verändern"-Anweisung. Gleiches Verhaltensmuster wie beim
// klassischen Weg den ganzen Rest der Session: gpt-image-1.5 bevorzugt ein plausibel aussehendes
// Ergebnis gegenüber exakter Bildtreue, sobald die Vorlage für das Modell schwer lesbar ist. Bleibt
// als Funktion erhalten (exportiert, damit kein Lint-Fehler) für den Fall, dass später ein
// zuverlässigerer Ansatz gefunden wird (z.B. rein mathematischer Schlagschatten statt KI) - aktuell
// liefert compositeJewelryVariant() den rohen Composite direkt aus.
export async function harmonizeComposite(
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

// Pendant zu generateProductImageVariant() (image-generation.ts) - gleiche Signatur/gleicher
// Rückgabewert ({buffer, prompt}), damit beide Wege austauschbar von image-actions.ts aufgerufen
// werden können. variantIndex wird aktuell nicht verwendet (kein recordApiUsage mehr, siehe oben)
// - bewusst trotzdem Teil der Signatur, für Interface-Parität und falls Kosten-Tracking hier später
// wieder gebraucht wird (z.B. bei einem zuverlässigeren Politur-Schritt).
export async function compositeJewelryVariant(
  product: SourceProductRow,
  model: MarinellModel,
  poseVariant: PoseVariant,
  variantIndex: number,
): Promise<{ buffer: Buffer; prompt: string }> {
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

  const motifCrops = await resolveMotifCrops(product, productBuffer);
  const rawComposite = await compositeRaw(baseBuffer, productBuffer, motifMm, motifCrops, calibration);

  // Kein KI-Aufruf (mehr) in diesem Pfad - siehe Kommentar bei harmonizeComposite() oben. Damit
  // auch keine Kosten zu verbuchen: der Compositing-Weg ist aktuell komplett kostenlos (reine
  // Bildmathematik), im Gegensatz zum klassischen Weg.
  return {
    buffer: rawComposite,
    prompt: `[Compositing-Weg: mathematisch exakt platziert, keine KI-Nachbearbeitung] ${model.name} - ${poseVariant.label}`,
  };
}
