import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import type { MarinellModel, PoseVariant } from "@/lib/image-facts";
import { motifSizeMm, referenceImageUrl, fetchImageBuffer } from "@/lib/image-generation";
import { estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";

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
// Prominenz des Produktfotos selbst. Dieser Pfad umgeht das für den ANHÄNGER, indem die Größe NICHT
// der KI überlassen wird: das Produktfoto wird rechnerisch korrekt auf ein festes, wiederverwendetes
// "leeres" Model-Foto montiert (reine Bildmathematik über sharp).
//
// Chronologie der KETTE (alles am 2026-08-23):
// 1) Ganzer Ketten+Anhänger-Ausschnitt kopiert + bei gedrehten Posen starr rotiert - physikalisch
//    falsch, ein echter Anhänger hängt durch Schwerkraft aufrecht, unabhängig vom Kopfwinkel.
// 2) Kette als Vektor-Kurve gezeichnet (SVG, feste Farbe aus dem Produktfoto abgetastet) - passte
//    sich zwar an jede Pose an, sah aber wie eine "gezeichnete" gerade Linie aus, nicht wie Metall
//    (keine Glieder-Textur, keine Lichtreflexe) - zu großer Stilbruch im sonst fotorealistischen Bild.
// 3) Aktuell: Anhänger bleibt EXAKT wie in 1)/2) (Bildmathematik, garantiert korrekte Größe/Design),
//    aber die Kette wird von gpt-image-1.5 in einen schmalen MASKIERTEN Korridor hineingeneriert
//    (generateChainViaMask()) - mit dem echten Produktfoto als Stilreferenz für Material/Farbe/
//    Gliederform. Sieht photorealistisch aus. WICHTIGER VORBEHALT: die Maske ist bei gpt-image-1.5
//    KEINE harte Pixel-Garantie wie bei klassischem DALL-E-2-Inpainting - ein Pixelvergleich hat
//    gezeigt, dass auch außerhalb des Korridors (z.B. Bildecken) leicht andere Werte herauskommen
//    (globale Neubelichtung). Der Anhänger bleibt dadurch nicht mehr zu 100% pixelgenau garantiert,
//    nur noch "mit hoher Wahrscheinlichkeit weitgehend unverändert" - explizite Nutzerentscheidung
//    (bestmögliche Optik statt harter Größen-Garantie). Macht diesen Pfad außerdem wieder
//    kostenpflichtig (ein echter OpenAI-Aufruf pro Variante), nicht mehr komplett kostenlos.
//
// Deutliche Einschränkung, Stand jetzt: nur EINE Model/Pose/Kategorie-Kombination ist kalibriert
// (Sophia, Frontal/Dreiviertelprofil/Seitlich, Colliers/Anhänger). Für alle anderen Kombinationen
// wirft compositeJewelryVariant() einen Fehler - der Aufrufer muss auf den klassischen Weg
// zurückfallen oder die Option in der UI deaktivieren (siehe hasCompositingSupport()). Jede weitere
// Kombination braucht ein eigenes, einmalig generiertes und kalibriertes Basis-Foto.

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
   * hervorkommt). Wenn gesetzt, generiert compositeJewelryVariant() eine Kette per KI in einem
   * maskierten Korridor zwischen diesen Punkten und dem oberen Rand des eingesetzten Anhängers
   * (siehe buildChainMask()/generateChainViaMask()) - jede Pose bekommt so eine zur jeweiligen
   * Kopf-/Halsdrehung passende Kette. Fehlt einer der beiden Punkte, wird gar keine Kette generiert
   * (nur der Anhänger) statt zu raten.
   */
  chainLeftAnchor?: ChainAnchor;
  chainRightAnchor?: ChainAnchor;
  /**
   * Kettenlänge (cm, entspricht sourceProducts.produktLaengeCm) des Produkts, mit dem
   * anchorYPercent kalibriert wurde - Referenzwert für die längenabhängige Höhenkorrektur, siehe
   * adjustedAnchorYPercent(). Ohne diesen Wert (oder ohne produktLaengeCm am Produkt) bleibt
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

// Manuelle Motiv-Ausschnitte (nur der Anhänger/das Cluster, OHNE Kette) für Produkte, bei denen
// detectMotifBoundingBox() nicht zuverlässig funktioniert (deckender Studio-Hintergrund statt
// echter Transparenz, siehe dort). Schlüssel: modellErweitert. 4R267R8 wurde über ein Prozent-
// Grid-Overlay auf dem 2000x2000-Foto ausgemessen (Cluster ca. x:30-72%, y:57-89%). Jedes weitere
// Produkt mit demselben Freisteller-Stil braucht vorerst denselben manuellen Schritt.
const PRODUCT_MOTIF_OVERRIDES: Record<string, MotifCropOverride> = {
  "4R267R8": { left: 600, top: 1140, width: 840, height: 640 },
};

async function resolvePendantCrop(
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

export type PendantPlacement = {
  buffer: Buffer;
  /** Oberer Mittelpunkt des eingesetzten Anhängers - Ansatzpunkt für die Kette (siehe unten). */
  attachPoint: { x: number; y: number };
};

// Reine Bildmathematik (keine KI): setzt den Anhänger (pendantCrop) unverändert/aufrecht in
// korrekter Realgröße auf den (ggf. per Kettenlänge höhenkorrigierten) Ankerpunkt und legt einen
// weichen Kontaktschatten darunter. Liefert zusätzlich attachPoint zurück, den generateChainViaMask()
// braucht, um die Kette exakt dort ansetzen zu lassen.
export async function compositeRaw(
  baseBuffer: Buffer,
  productBuffer: Buffer,
  motifMm: number,
  chainLengthCm: number | null,
  pendantCrop: MotifCropOverride,
  calibration: PoseCalibration,
): Promise<PendantPlacement> {
  const sharp = await loadSharp();
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
  const shadowOffset = Math.max(1, Math.round(targetH * 0.05));
  const shadowBlur = Math.max(0.5, targetH * 0.04);
  const shadow = await sharp(resizedPendant)
    .ensureAlpha()
    .linear([0, 0, 0, 1], [0, 0, 0, 0])
    .blur(shadowBlur)
    .linear([1, 1, 1, 0.35], [0, 0, 0, 0])
    .png()
    .toBuffer();

  const buffer = await sharp(baseBuffer)
    .composite([
      { input: shadow, left: pasteLeft, top: pasteTop + shadowOffset },
      { input: resizedPendant, left: pasteLeft, top: pasteTop },
    ])
    .png()
    .toBuffer();

  return { buffer, attachPoint: { x: anchorX, y: pasteTop } };
}

// Breite des editierbaren Korridors (Pixel) für die maskierte Ketten-Generierung - großzügig genug,
// damit die KI eine natürlich wirkende Kette zeichnen kann, ohne in den geschützten Bereich
// (Anhänger, Gesicht, Rest) hineinzumüssen. Empirisch aus einem Testlauf übernommen (22px bei
// 1024px Bildbreite = ca. 8mm bei pxPerMm≈2.76).
const CHAIN_MASK_CORRIDOR_PX = 22;

function chainPathD(from: { x: number; y: number }, to: { x: number; y: number }): string {
  // Kontrollpunkt der Bezierkurve mittig zwischen Start/Ziel, leicht nach unten versetzt (Anteil
  // des vertikalen Abstands) - simuliert den natürlichen, aber am echten Produktfoto nur sehr
  // leichten Durchhang einer eng anliegenden Kette (siehe Fund 2026-08-23: ein größerer Faktor sah
  // wie ein spitzes, unrealistisches "V" aus, wenn man es direkt als Linie zeichnet).
  const midX = (from.x + to.x) / 2;
  const sag = Math.max(1, Math.abs(to.y - from.y) * 0.08 + 1);
  const midY = (from.y + to.y) / 2 + sag;
  return `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`;
}

// Baut die Editier-Maske für die KI-Ketten-Generierung: ein PNG in Basisfoto-Größe, bei dem NUR ein
// schmaler Korridor entlang der beiden Ketten-Kurven (chainLeftAnchor/chainRightAnchor -> attachPoint)
// transparent (= editierbar laut OpenAI-API) ist, der Rest komplett undurchsichtig (= geschützt).
// Technik: Korridor-Pfade als weiße Striche auf transparentem Grund rendern, deren Alpha-Kanal
// invertieren (Strich wird zu Alpha=0/editierbar, Rest zu Alpha=255/geschützt) und als Alpha-Kanal
// eines vollflächigen Bilds einsetzen.
async function buildChainMask(
  canvasWidth: number,
  canvasHeight: number,
  leftPoint: { x: number; y: number },
  rightPoint: { x: number; y: number },
  attachPoint: { x: number; y: number },
): Promise<Buffer> {
  const sharp = await loadSharp();
  const svg =
    `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${chainPathD(leftPoint, attachPoint)}" stroke="white" stroke-width="${CHAIN_MASK_CORRIDOR_PX}" fill="none" stroke-linecap="round"/>` +
    `<path d="${chainPathD(rightPoint, attachPoint)}" stroke="white" stroke-width="${CHAIN_MASK_CORRIDOR_PX}" fill="none" stroke-linecap="round"/>` +
    `</svg>`;
  const corridorShape = await sharp(Buffer.from(svg)).png().toBuffer();
  const corridorAlpha = await sharp(corridorShape).ensureAlpha().extractChannel("alpha").toBuffer();
  const invertedAlpha = await sharp(corridorAlpha).negate().raw().toBuffer();
  const opaqueBase = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .raw()
    .toBuffer();
  return sharp(opaqueBase, { raw: { width: canvasWidth, height: canvasHeight, channels: 3 } })
    .joinChannel(invertedAlpha, { raw: { width: canvasWidth, height: canvasHeight, channels: 1 } })
    .png()
    .toBuffer();
}

// Einziger KI-Aufruf in diesem Pfad: generiert NUR innerhalb des maskierten Korridors (siehe
// buildChainMask()) eine Kette, die vom Hals zum bereits eingesetzten Anhänger führt. Nutzt das
// echte Produktfoto als zweites Bild, damit Material/Farbe/Gliederform zum tatsächlichen
// Schmuckstück passen, statt geraten zu werden. input_fidelity "high", damit sich die KI so nah wie
// möglich am ersten Bild orientiert (Gegenteil des Problems beim klassischen Weg, wo "high" das
// Produktfoto zu wörtlich als Größenvorlage nahm - hier ist "möglichst wenig verändern" das Ziel).
//
// WICHTIGER VORBEHALT (siehe Kommentar oben im Datei-Header): die Maske ist bei gpt-image-1.5 keine
// harte Pixel-Garantie - ein Pixelvergleich zeigt leichte Abweichungen auch außerhalb des Korridors
// (globale Neu-Belichtung). Der Anhänger bleibt dadurch NICHT zu 100% pixelgenau erhalten, nur mit
// hoher Wahrscheinlichkeit weitgehend unverändert. Bewusste Nutzerentscheidung (2026-08-23):
// bestmögliche Optik hat Vorrang vor der harten Größen-Garantie des reinen Mathematik-Wegs.
async function generateChainViaMask(
  pendantOnlyBuffer: Buffer,
  productBuffer: Buffer,
  maskBuffer: Buffer,
  materialLabel: string | null,
  apiKey: string,
): Promise<{ buffer: Buffer; usage: unknown }> {
  const materialHint = materialLabel ? ` Material: ${materialLabel}.` : "";
  const prompt =
    "Kontext: professionelle E-Commerce-Schmuckfotografie, seriös, nicht sexualisiert. Zeichne NUR " +
    "im transparenten/editierbaren Bereich der Maske eine dünne, elegante Halskette, die natürlich " +
    "vom Hals kommend zu dem bereits vorhandenen Anhänger führt und dort ansetzt - exakt im Stil " +
    "(Farbe, Gliederform, Metallglanz) wie im zweiten Referenzbild gezeigt." +
    materialHint +
    " Die Kette liegt eng am Hals an, mit realistischem Metallglanz und feinen Lichtreflexen, " +
    "keine übertriebene Dicke. Der Rest des Bildes (Gesicht, Haare, Kleidung, Hintergrund, der " +
    "bereits platzierte Anhänger) ist durch die Maske geschützt - verändere dort nichts. Kein " +
    "zusätzlicher Schmuck.";

  const [pendantFile, productFile, maskFile] = await Promise.all([
    toFile(pendantOnlyBuffer, "pendant-only", { type: "image/png" }),
    toFile(productBuffer, "product-reference", { type: "image/png" }),
    toFile(maskBuffer, "mask", { type: "image/png" }),
  ]);

  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const response = await client.images.edit({
    image: [pendantFile, productFile],
    mask: maskFile,
    prompt,
    model: OPENAI_IMAGE_MODEL,
    size: "1024x1536",
    quality: "high",
    input_fidelity: "high",
    output_format: "png",
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Ketten-Generierung hat kein Bild zurückgegeben.");
  return { buffer: Buffer.from(b64, "base64"), usage: response.usage };
}

// Pendant zu generateProductImageVariant() (image-generation.ts) - gleiche Signatur/gleicher
// Rückgabewert ({buffer, prompt}), damit beide Wege austauschbar von image-actions.ts aufgerufen
// werden können.
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

  const pendantCrop = await resolvePendantCrop(product, productBuffer);
  const { buffer: pendantOnly, attachPoint } = await compositeRaw(
    baseBuffer,
    productBuffer,
    motifMm,
    product.produktLaengeCm,
    pendantCrop,
    calibration,
  );

  // Ohne Ketten-Kalibrierung für diese Pose (oder ohne API-Key) bleibt es beim Anhänger allein,
  // statt zu raten oder zu crashen - besser ein Bild ohne Kette als ein fehlgeschlagenes.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!calibration.chainLeftAnchor || !calibration.chainRightAnchor || !apiKey) {
    return {
      buffer: pendantOnly,
      prompt: `[Compositing-Weg: mathematisch platziert, keine Kette] ${model.name} - ${poseVariant.label}`,
    };
  }

  const baseMeta = await (await loadSharp())(baseBuffer).metadata();
  const baseW = baseMeta.width!;
  const baseH = baseMeta.height!;
  const leftPoint = {
    x: (calibration.chainLeftAnchor.xPercent / 100) * baseW,
    y: (calibration.chainLeftAnchor.yPercent / 100) * baseH,
  };
  const rightPoint = {
    x: (calibration.chainRightAnchor.xPercent / 100) * baseW,
    y: (calibration.chainRightAnchor.yPercent / 100) * baseH,
  };
  const mask = await buildChainMask(baseW, baseH, leftPoint, rightPoint, attachPoint);

  const materialLabel = [product.hauptmaterial, product.legierung].filter(Boolean).join(", ") || null;
  const { buffer: withChain, usage } = await generateChainViaMask(
    pendantOnly,
    productBuffer,
    mask,
    materialLabel,
    apiKey,
  );

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
    buffer: withChain,
    prompt: `[Compositing-Weg: Anhänger mathematisch platziert, Kette per KI in maskiertem Korridor] ${model.name} - ${poseVariant.label}`,
  };
}
