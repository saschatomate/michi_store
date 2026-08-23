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
// Zweite Iteration (ebenfalls 2026-08-23): den kompletten Ketten+Anhänger-Ausschnitt bei gedrehten
// Posen einfach starr zu rotieren war physikalisch falsch - ein echter Anhänger hängt durch die
// Schwerkraft relativ aufrecht, unabhängig vom Kopfwinkel, nur die Kette folgt dem Hals. Deshalb
// jetzt: der Anhänger wird UNROTIERT aus dem Produktfoto eingesetzt (wie eh schon), die Kette wird
// NICHT mehr aus dem Foto kopiert, sondern als eigene, zur jeweiligen Pose passende Kurve
// GEZEICHNET (siehe drawChain()) - Farbe wird aus dem Produktfoto abgetastet, nicht geraten.
//
// Deutliche Einschränkung, Stand jetzt: nur EINE Model/Pose/Kategorie-Kombination ist kalibriert
// (Sophia, Frontal, Colliers/Anhänger). Für alle anderen Kombinationen wirft
// compositeJewelryVariant() einen Fehler - der Aufrufer muss auf den klassischen Weg zurückfallen
// oder die Option in der UI deaktivieren (siehe hasCompositingSupport()). Jede weitere Kombination
// braucht ein eigenes, einmalig generiertes und kalibriertes Basis-Foto (siehe PoseCalibration).

export type ChainAnchor = { xPercent: number; yPercent: number };

export type PoseCalibration = {
  /** Festes, wiederverwendetes Foto des Models in dieser Pose, OHNE jeglichen Schmuck. */
  baseImageUrl: string;
  /** Ankerpunkt (Mittelpunkt der Anhänger-Platzierung) als Prozent der Bildbreite/-höhe. */
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
   * Nur für Kategorien mit Kette (Colliers/Anhänger), optional: zwei Punkte auf DIESEM Basisfoto,
   * an denen die Kette links/rechts vom Hals kommend sichtbar wird (z.B. wo sie unter dem Haar
   * hervorkommt). Wenn gesetzt (zusammen mit ProductMotifCrops.chainColorSample), zeichnet
   * compositeRaw() eine Kette zwischen diesen Punkten und dem oberen Rand des eingesetzten
   * Anhängers - jede Pose bekommt so eine zur jeweiligen Kopf-/Halsdrehung passende Kette, statt
   * einer starren Kopie aus dem (immer aus EINEM Winkel fotografierten) Original. Fehlt einer der
   * beiden Punkte, wird gar keine Kette gezeichnet (nur der Anhänger) statt zu raten.
   */
  chainLeftAnchor?: ChainAnchor;
  chainRightAnchor?: ChainAnchor;
  /**
   * Kettenlänge (cm, entspricht sourceProducts.produktLaengeCm) des Produkts, mit dem
   * anchorYPercent kalibriert wurde - Referenzwert für die längenabhängige Höhenkorrektur, siehe
   * adjustAnchorYForChainLength(). Ohne diesen Wert (oder ohne produktLaengeCm am Produkt) bleibt
   * anchorYPercent unverändert für jedes Produkt gleich.
   */
  referenceChainLengthCm?: number;
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
//
// chainLeftAnchor/chainRightAnchor sind erste Schätzungen (per Augenmaß aus den Basisfotos
// abgelesen, nicht exakt ausgemessen) - nach Sichtprüfung ggf. nachjustieren.
export const POSE_CALIBRATIONS: Record<string, PoseCalibration> = {
  "sophia:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-hals.png",
    anchorXPercent: 50,
    anchorYPercent: 64,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 33, yPercent: 52 },
    chainRightAnchor: { xPercent: 67, yPercent: 52 },
    referenceChainLengthCm: 45.7,
  },
  "sophia:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-hals.png",
    anchorXPercent: 52,
    anchorYPercent: 63,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 36, yPercent: 50 },
    chainRightAnchor: { xPercent: 70, yPercent: 52 },
    referenceChainLengthCm: 45.7,
  },
  "sophia:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-hals.png",
    anchorXPercent: 48,
    anchorYPercent: 62,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 30, yPercent: 48 },
    chainRightAnchor: { xPercent: 66, yPercent: 50 },
    referenceChainLengthCm: 45.7,
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
// statt ein falsches Ergebnis zu riskieren - der Aufrufer muss dann einen manuellen Crop hinterlegen.
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

export type ProductMotifCrops = {
  /** NUR der Anhänger/das Cluster selbst (ohne Kette) - wird unverändert/aufrecht eingesetzt. */
  pendantCrop: MotifCropOverride;
  /**
   * Kleiner Bereich im Produktfoto, der sicher auf der Kette liegt (nicht auf einem Stein, nicht
   * auf dem Hintergrund) - wird für die Kettenfarbe abgetastet (Durchschnittsfarbe des Bereichs).
   * Nur nötig, wenn die Pose-Kalibrierung chainLeftAnchor/chainRightAnchor gesetzt hat.
   */
  chainColorSample?: MotifCropOverride;
};

// Manuelle Motiv-Ausschnitte für Produkte, bei denen detectMotifBoundingBox() nicht zuverlässig
// funktioniert (deckender Studio-Hintergrund statt echter Transparenz, siehe dort). Schlüssel:
// modellErweitert. 4R267R8 wurde einmalig über ein Prozent-Grid-Overlay auf dem 2000x2000-Foto
// ausgemessen (Cluster ca. x:42-69%, y:55-87%; Kettenfarbe-Sample nahe der Bildmitte oben, wo die
// Kette sicher verläuft). Jedes weitere Produkt mit demselben Freisteller-Stil braucht vorerst
// denselben manuellen Schritt, bis eine robustere automatische Erkennung existiert.
const PRODUCT_MOTIF_OVERRIDES: Record<string, ProductMotifCrops> = {
  "4R267R8": {
    // Korrigiert (war zu schmal, hat die äußeren 2 Ovale leicht angeschnitten): x ca. 30-72%,
    // y ca. 57-89% auf dem 2000x2000-Foto.
    pendantCrop: { left: 600, top: 1140, width: 840, height: 640 },
    // Korrigiert (Original-Punkt lag in der Lücke zwischen den beiden Kettensträngen, hat den
    // hellen Hintergrund statt der Kette abgetastet) - jetzt auf einem Kettenglied links oben.
    chainColorSample: { left: 270, top: 130, width: 60, height: 60 },
  },
};

async function resolveMotifCrops(
  product: SourceProductRow,
  productBuffer: Buffer,
): Promise<ProductMotifCrops> {
  const override = PRODUCT_MOTIF_OVERRIDES[product.modellErweitert];
  if (override) return override;
  const detected = await detectMotifBoundingBox(productBuffer);
  if (detected) return { pendantCrop: detected };
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

// Durchschnittsfarbe eines kleinen Bildbereichs (für die Kettenfarbe - aus dem echten Produktfoto
// abgetastet statt geraten/hart codiert, damit es bei jedem Metall/jeder Legierung passt).
async function sampleAverageColor(
  buffer: Buffer,
  region: MotifCropOverride,
): Promise<{ r: number; g: number; b: number }> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(buffer)
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixelCount; i++) {
    r += data[i * info.channels];
    g += data[i * info.channels + 1];
    b += data[i * info.channels + 2];
  }
  return { r: Math.round(r / pixelCount), g: Math.round(g / pixelCount), b: Math.round(b / pixelCount) };
}

// Zeichnet die Kette als zwei weiche Kurven (quadratische Bezier, mit Durchhang) von je einem
// chainLeftAnchor/chainRightAnchor-Punkt zum oberen Rand des Anhängers - reine Vektorgrafik (SVG),
// keine Kopie aus dem Produktfoto, deshalb automatisch passend zu JEDER Pose. Läuft auf einer
// Canvas in Basisfoto-Größe, damit sie direkt (ohne weitere Positionsberechnung) über das
// Basisfoto gelegt werden kann.
async function drawChain(
  canvasWidth: number,
  canvasHeight: number,
  leftPoint: { x: number; y: number },
  rightPoint: { x: number; y: number },
  attachPoint: { x: number; y: number },
  colorHex: string,
  strokeWidthPx: number,
): Promise<Buffer> {
  const sharp = await loadSharp();
  function pathFor(from: { x: number; y: number }): string {
    // Kontrollpunkt der Bezierkurve mittig zwischen Start/Ziel, leicht nach unten versetzt (Anteil
    // des vertikalen Abstands) - simuliert den natürlichen Durchhang einer Kette unter Schwerkraft.
    // Faktor bewusst klein (0.08 statt ursprünglich 0.35, siehe Fund 2026-08-23): am echten
    // Produktfoto liegt die Kette straff/fast gerade an, keine tiefe Kurve - 0.35 sah wie ein
    // spitzes, unrealistisches "V" aus.
    const midX = (from.x + attachPoint.x) / 2;
    const sag = Math.max(1, Math.abs(attachPoint.y - from.y) * 0.08 + 1);
    const midY = (from.y + attachPoint.y) / 2 + sag;
    return `M ${from.x} ${from.y} Q ${midX} ${midY} ${attachPoint.x} ${attachPoint.y}`;
  }
  const svg =
    `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${pathFor(leftPoint)}" stroke="${colorHex}" stroke-width="${strokeWidthPx}" fill="none" stroke-linecap="round"/>` +
    `<path d="${pathFor(rightPoint)}" stroke="${colorHex}" stroke-width="${strokeWidthPx}" fill="none" stroke-linecap="round"/>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Ein Anhänger hängt an einer längeren Kette tiefer, an einer kürzeren höher - anchorYPercent ist
// aber pro Pose auf GENAU EINE Referenzlänge kalibriert (referenceChainLengthCm, das Produkt, mit
// dem der Ankerpunkt bestimmt wurde). Für andere Kettenlängen wird die Höhe proportional verschoben.
// Faustregel (grobe Näherung, keine exakte Drapier-Physik): ca. die Hälfte einer zusätzlichen
// Kettenlänge wird zu zusätzlichem Frontal-Abstand vom Hals, ein in der Schmuckbranche gängiger
// Vereinfachungsfaktor für die Halskette-Drape (kurze Kette liegt eng am Hals mit wenig Spiel,
// überschüssige Länge verteilt sich als Durchhang auf beide Seiten der Front-Mitte). Ohne
// referenceChainLengthCm (Kalibrierung) oder produktLaengeCm (Produkt) bleibt anchorYPercent
// unverändert, statt mit unvollständigen Daten zu raten.
function adjustedAnchorYPercent(
  calibration: PoseCalibration,
  chainLengthCm: number | null,
  baseH: number,
): number {
  if (!chainLengthCm || !calibration.referenceChainLengthCm) return calibration.anchorYPercent;
  const dropChangeCm = (chainLengthCm - calibration.referenceChainLengthCm) * 0.5;
  const dropChangeMm = dropChangeCm * 10;
  const dropChangePx = dropChangeMm * calibration.pxPerMm;
  const dropChangePercent = (dropChangePx / baseH) * 100;
  return calibration.anchorYPercent + dropChangePercent;
}

// Reine Bildmathematik (keine KI): setzt den Anhänger (pendantCrop) unverändert/aufrecht in
// korrekter Realgröße auf den (ggf. per Kettenlänge höhenkorrigierten) Ankerpunkt, zeichnet bei
// Colliers/Anhänger zusätzlich eine zur Pose passende Kette (siehe drawChain()) und legt einen
// weichen Kontaktschatten unter den Anhänger.
export async function compositeRaw(
  baseBuffer: Buffer,
  productBuffer: Buffer,
  motifMm: number,
  chainLengthCm: number | null,
  crops: ProductMotifCrops,
  calibration: PoseCalibration,
): Promise<Buffer> {
  const sharp = await loadSharp();
  const { pendantCrop, chainColorSample } = crops;
  const baseMeta = await sharp(baseBuffer).metadata();
  const baseW = baseMeta.width!;
  const baseH = baseMeta.height!;

  const cropped = await sharp(productBuffer).extract(pendantCrop).png().toBuffer();

  // Skalierungsfaktor: wie viel kleiner/größer muss pendantCrop werden, damit seine LÄNGERE Seite
  // effectiveMm * calibration.pxPerMm Pixel misst (motifMm bezieht sich auf die größere reale
  // Abmessung, siehe motifSizeMm() in image-generation.ts; effectiveMm siehe MIN_RENDER_MM oben).
  const effectiveMm = Math.max(motifMm, MIN_RENDER_MM);
  const pendantLongerPx = Math.max(pendantCrop.width, pendantCrop.height);
  const targetLongerPx = effectiveMm * calibration.pxPerMm;
  const scaleFactor = targetLongerPx / pendantLongerPx;
  const targetW = Math.max(1, Math.round(pendantCrop.width * scaleFactor));
  const targetH = Math.max(1, Math.round(pendantCrop.height * scaleFactor));
  const resizedPendant = await sharp(cropped).resize(targetW, targetH).png().toBuffer();

  const anchorX = Math.round((calibration.anchorXPercent / 100) * baseW);
  const anchorY = Math.round((adjustedAnchorYPercent(calibration, chainLengthCm, baseH) / 100) * baseH);
  const pasteLeft = Math.round(anchorX - targetW / 2);
  const pasteTop = Math.round(anchorY - targetH / 2);

  // Weicher Kontaktschatten (reine Bildmathematik, keine KI): Silhouette des Anhängers, geschwärzt,
  // etwas nach unten versetzt (passend zum etablierten "warmes Licht von links oben"-Look, siehe
  // SYSTEM_INSTRUCTIONS_BEFORE_CLOTHING in image-generation.ts) und weichgezeichnet, mit reduzierter
  // Deckkraft. Versatz/Weichzeichnung bewusst proportional zur Motivgröße (nicht fest in Pixeln),
  // damit es bei jeder Größe wie ein echter, feiner Schatten wirkt statt wie ein fester Klecks.
  // a=[0,0,0,x] auf RGB heißt "auf Schwarz multiplizieren" (Silhouette einfärben), b=0 addiert
  // nichts dazu; die Alpha-Bande bleibt mit a=1 unverändert, erst der zweite linear()-Aufruf
  // reduziert sie auf ~35% Deckkraft.
  const shadowOffset = Math.max(1, Math.round(targetH * 0.05));
  const shadowBlur = Math.max(0.5, targetH * 0.04);
  const shadow = await sharp(resizedPendant)
    .ensureAlpha()
    .linear([0, 0, 0, 1], [0, 0, 0, 0])
    .blur(shadowBlur)
    .linear([1, 1, 1, 0.35], [0, 0, 0, 0])
    .png()
    .toBuffer();

  const layers: { input: Buffer; left: number; top: number }[] = [];

  // Kette unterste Ebene (liegt teilweise "unter" dem Anhänger, wie bei einer echten Kette) - nur
  // wenn sowohl die Pose (chainLeftAnchor/chainRightAnchor) als auch das Produkt
  // (chainColorSample) das hergeben. Fehlt eines von beiden, wird bewusst KEINE Kette gezeichnet
  // statt eine geratene Farbe/Position zu riskieren - nur der Anhänger erscheint dann.
  if (calibration.chainLeftAnchor && calibration.chainRightAnchor && chainColorSample) {
    const color = await sampleAverageColor(productBuffer, chainColorSample);
    const colorHex = `rgb(${color.r},${color.g},${color.b})`;
    const strokeWidthPx = Math.max(1, 1.5 * calibration.pxPerMm); // ~1.5mm reale Kettenbreite
    const attachPoint = { x: anchorX, y: pasteTop }; // oberer Rand des eingesetzten Anhängers
    const leftPoint = {
      x: (calibration.chainLeftAnchor.xPercent / 100) * baseW,
      y: (calibration.chainLeftAnchor.yPercent / 100) * baseH,
    };
    const rightPoint = {
      x: (calibration.chainRightAnchor.xPercent / 100) * baseW,
      y: (calibration.chainRightAnchor.yPercent / 100) * baseH,
    };
    const chainLayer = await drawChain(baseW, baseH, leftPoint, rightPoint, attachPoint, colorHex, strokeWidthPx);
    layers.push({ input: chainLayer, left: 0, top: 0 });
  }

  layers.push({ input: shadow, left: pasteLeft, top: pasteTop + shadowOffset });
  layers.push({ input: resizedPendant, left: pasteLeft, top: pasteTop });

  return sharp(baseBuffer).composite(layers).png().toBuffer();
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
// zuverlässigerer Ansatz gefunden wird - aktuell liefert compositeJewelryVariant() den rohen
// Composite (inkl. gezeichneter Kette + Kontaktschatten) direkt aus.
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
  const rawComposite = await compositeRaw(
    baseBuffer,
    productBuffer,
    motifMm,
    product.produktLaengeCm,
    motifCrops,
    calibration,
  );

  // Kein KI-Aufruf in diesem Pfad - siehe Kommentar bei harmonizeComposite() oben. Damit auch keine
  // Kosten zu verbuchen: der Compositing-Weg ist komplett kostenlos (reine Bildmathematik), im
  // Gegensatz zum klassischen Weg.
  return {
    buffer: rawComposite,
    prompt: `[Compositing-Weg: mathematisch platziert, Kette gezeichnet, keine KI] ${model.name} - ${poseVariant.label}`,
  };
}
