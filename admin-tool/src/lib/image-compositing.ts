import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import type { MarinellModel, PoseVariant } from "@/lib/image-facts";
import { motifSizeMm, referenceImageUrl, fetchImageBuffer, guessMimeType } from "@/lib/image-generation";
import { estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";
import { describeChainForImagePrompt, verifyPendantIntact } from "@/lib/text-generation";

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
// 3) Anhänger bleibt EXAKT wie in 1)/2) (Bildmathematik, garantiert korrekte Größe/Design), aber
//    die Kette wird von gpt-image-1.5 in einen schmalen MASKIERTEN Korridor hineingeneriert
//    (generateChainViaMask()). ERSTER Versuch gab zusätzlich das rohe Produktfoto als zweites
//    Referenzbild mit (für Material/Farbe/Gliederform) - Ergebnis: die KI hat sich davon nicht nur
//    inhaltlich, sondern auch stilistisch leiten lassen und die KOMPLETTE Bildkomposition verworfen
//    (Pose/Gesicht/Hintergrund neu generiert, einmal sogar auf den transparenten Hintergrund des
//    Produktfotos zurückgesetzt) - hat die drei kalibrierten Posen faktisch ignoriert. Fix: KEIN
//    zweites Bild mehr, Material/Farbe nur noch per Textbeschreibung - damit bleibt die Pose
//    zuverlässig erhalten. WICHTIGER VORBEHALT bleibt trotzdem: die Maske ist bei gpt-image-1.5
//    KEINE harte Pixel-Garantie wie bei klassischem DALL-E-2-Inpainting - ein Pixelvergleich hat
//    gezeigt, dass auch außerhalb des Korridors (z.B. Bildecken) leicht andere Werte herauskommen
//    (globale Neubelichtung). Der Anhänger bleibt dadurch nicht zu 100% pixelgenau garantiert, nur
//    noch "mit hoher Wahrscheinlichkeit weitgehend unverändert" - explizite Nutzerentscheidung
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
// REKALIBRIERUNG (v2, alle 36 Kombis): der komplette bisherige Basisfoto-Bestand (baseImageUrl
// oben) wurde mit client.images.generate() erzeugt - reinem Text-zu-Bild OHNE das echte
// Model-Referenzfoto anzuhängen, anders als der klassische Produktfoto-Weg
// (generateProductImageVariant() hängt das Referenzfoto IMMER an). Ergebnis: sichtbare Abweichung
// vom echten Model in allen 4 weiblichen Models (Claire/Amara am deutlichsten). Fix bewiesen:
// Testgenerierung mit images.edit() + Referenzfoto zeigt deutlich bessere Übereinstimmung (Licht,
// Gesichtsform). Alle 36 Basisfotos (4 Models × 3 Kategorien × 3 Posen) wurden daraufhin mit dem
// referenzfoto-gestützten Weg neu generiert und unter NEUEN Pfaden (Suffix "-v2") hochgeladen -
// die alten Fotos bleiben unter ihren ursprünglichen Pfaden im Storage erhalten (kein Overwrite),
// falls sie später nochmal gebraucht werden. Jeder einzelne Anker wurde komplett neu vermessen
// (nicht von den alten Werten übernommen) - eine Anfangs-Direktübernahme der alten Ring-Ankerwerte
// für 5 der 12 Kombis erwies sich bei genauer Prüfung (echte Pixel-Gridlines statt grober
// 0.7x-Übersicht) in 4 von 5 Fällen als daneben, weil sich Kopf-/Handposition zwischen alter und
// neuer Generierung leicht verschiebt - jede Kombi wurde daher einzeln per Grid-Overlay
// nachgemessen und per Crosshair-Overlay visuell verifiziert. Colliers-Anker (Anhänger-Position +
// Ketten-Anker) waren die Ausnahme: die alten Prozent-Werte trafen nach Sichtprüfung an den neuen
// Fotos direkt (gleiches Framing/gleiche Pose-Vorgabe), nur pxPerMm wurde über den Pupillenabstand
// neu gemessen (deutlich höher als der alte gemeinsame Wert 2.76 - die neuen Fotos zoomen enger
// aufs Gesicht - und streut anders als früher spürbar pro Model, daher pro Model statt gemeinsam
// gehalten). Ring/Ohrschmuck-pxPerMm unverändert von den alten Werten übernommen (weiterhin
// plausible Schätzung ohne verlässliche Anatomie-Konstante, siehe ursprüngliche Begründung unten).
export const POSE_CALIBRATIONS: Record<string, PoseCalibration> = {
  "sophia:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-hals-v2.png",
    anchorXPercent: 50,
    anchorYPercent: 64,
    pxPerMm: 3.05,
    chainLeftAnchor: { xPercent: 33, yPercent: 52 },
    chainRightAnchor: { xPercent: 67, yPercent: 52 },
    referenceChainLengthCm: 45.7,
  },
  "sophia:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-hals-v2.png",
    anchorXPercent: 52,
    anchorYPercent: 63,
    pxPerMm: 3.05,
    chainLeftAnchor: { xPercent: 36, yPercent: 50 },
    chainRightAnchor: { xPercent: 70, yPercent: 52 },
    referenceChainLengthCm: 45.7,
  },
  "sophia:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-hals-v2.png",
    anchorXPercent: 48,
    anchorYPercent: 62,
    pxPerMm: 3.05,
    chainLeftAnchor: { xPercent: 30, yPercent: 48 },
    chainRightAnchor: { xPercent: 66, yPercent: 50 },
    referenceChainLengthCm: 45.7,
  },
  "claire:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-frontal-hals-v2.png",
    anchorXPercent: 48,
    anchorYPercent: 64,
    pxPerMm: 3.69,
    chainLeftAnchor: { xPercent: 31, yPercent: 52 },
    chainRightAnchor: { xPercent: 65, yPercent: 52 },
    referenceChainLengthCm: 45.7,
  },
  "claire:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-dreiviertelprofil-hals-v2.png",
    anchorXPercent: 46,
    anchorYPercent: 53,
    pxPerMm: 3.69,
    chainLeftAnchor: { xPercent: 39, yPercent: 44 },
    chainRightAnchor: { xPercent: 74, yPercent: 44 },
    referenceChainLengthCm: 45.7,
  },
  "claire:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-seitlich-hals-v2.png",
    anchorXPercent: 56,
    anchorYPercent: 55,
    pxPerMm: 3.69,
    chainLeftAnchor: { xPercent: 27, yPercent: 49 },
    chainRightAnchor: { xPercent: 81, yPercent: 48 },
    referenceChainLengthCm: 45.7,
  },
  "jen:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-frontal-hals-v2.png",
    anchorXPercent: 49,
    anchorYPercent: 57,
    pxPerMm: 3.59,
    chainLeftAnchor: { xPercent: 29, yPercent: 47 },
    chainRightAnchor: { xPercent: 68, yPercent: 47 },
    referenceChainLengthCm: 45.7,
  },
  "jen:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-dreiviertelprofil-hals-v2.png",
    anchorXPercent: 54,
    anchorYPercent: 60,
    pxPerMm: 3.59,
    chainLeftAnchor: { xPercent: 27, yPercent: 49 },
    chainRightAnchor: { xPercent: 76, yPercent: 49 },
    referenceChainLengthCm: 45.7,
  },
  "jen:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-seitlich-hals-v2.png",
    anchorXPercent: 45,
    anchorYPercent: 60,
    pxPerMm: 3.59,
    chainLeftAnchor: { xPercent: 24, yPercent: 49 },
    chainRightAnchor: { xPercent: 73, yPercent: 49 },
    referenceChainLengthCm: 45.7,
  },
  "amara:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-frontal-hals-v2.png",
    anchorXPercent: 51,
    anchorYPercent: 61,
    pxPerMm: 3.5,
    chainLeftAnchor: { xPercent: 29, yPercent: 42 },
    chainRightAnchor: { xPercent: 73, yPercent: 42 },
    referenceChainLengthCm: 45.7,
  },
  "amara:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-dreiviertelprofil-hals-v2.png",
    anchorXPercent: 52,
    anchorYPercent: 59,
    pxPerMm: 3.5,
    chainLeftAnchor: { xPercent: 27, yPercent: 42 },
    chainRightAnchor: { xPercent: 68, yPercent: 42 },
    referenceChainLengthCm: 45.7,
  },
  "amara:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-seitlich-hals-v2.png",
    anchorXPercent: 45,
    anchorYPercent: 61,
    pxPerMm: 3.5,
    chainLeftAnchor: { xPercent: 27, yPercent: 46 },
    chainRightAnchor: { xPercent: 64, yPercent: 46 },
    referenceChainLengthCm: 45.7,
  },
  "sophia:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-ring-v2.png",
    anchorXPercent: 77.9,
    anchorYPercent: 48.5,
    pxPerMm: 2.9,
  },
  "sophia:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-ring-v2.png",
    anchorXPercent: 77.2,
    anchorYPercent: 39.2,
    pxPerMm: 2.9,
  },
  "sophia:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-ring-v2.png",
    anchorXPercent: 47.5,
    anchorYPercent: 28.1,
    pxPerMm: 2.9,
  },
  "sophia:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-ohr-v2.png",
    anchorXPercent: 64.3,
    anchorYPercent: 27.7,
    pxPerMm: 3.08,
  },
  "sophia:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-ohr-v2.png",
    anchorXPercent: 53.2,
    anchorYPercent: 22.5,
    pxPerMm: 2.63,
  },
  "sophia:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-ohr-v2.png",
    anchorXPercent: 49.3,
    anchorYPercent: 22.8,
    pxPerMm: 2.68,
  },
  "claire:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-frontal-ring-v2.png",
    anchorXPercent: 68.1,
    anchorYPercent: 56.9,
    pxPerMm: 2.7,
  },
  "claire:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-dreiviertelprofil-ring-v2.png",
    anchorXPercent: 63.4,
    anchorYPercent: 55.5,
    pxPerMm: 2.7,
  },
  "claire:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-seitlich-ring-v2.png",
    anchorXPercent: 65.2,
    anchorYPercent: 52.9,
    pxPerMm: 2.7,
  },
  "claire:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-frontal-ohr-v2.png",
    anchorXPercent: 30.3,
    anchorYPercent: 29.9,
    pxPerMm: 3.08,
  },
  "claire:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-dreiviertelprofil-ohr-v2.png",
    anchorXPercent: 35.6,
    anchorYPercent: 27.7,
    pxPerMm: 2.63,
  },
  "claire:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-seitlich-ohr-v2.png",
    anchorXPercent: 36.1,
    anchorYPercent: 28.3,
    pxPerMm: 2.68,
  },
  "jen:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-frontal-ring-v2.png",
    anchorXPercent: 68.7,
    anchorYPercent: 53.7,
    pxPerMm: 2.8,
  },
  "jen:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-dreiviertelprofil-ring-v2.png",
    anchorXPercent: 68.7,
    anchorYPercent: 46.9,
    pxPerMm: 2.8,
  },
  "jen:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-seitlich-ring-v2.png",
    anchorXPercent: 63.0,
    anchorYPercent: 35.4,
    pxPerMm: 2.8,
  },
  "jen:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-frontal-ohr-v2.png",
    anchorXPercent: 78.1,
    anchorYPercent: 27.7,
    pxPerMm: 3.0,
  },
  "jen:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-dreiviertelprofil-ohr-v2.png",
    anchorXPercent: 64.9,
    anchorYPercent: 26.4,
    pxPerMm: 2.8,
  },
  "jen:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-seitlich-ohr-v2.png",
    anchorXPercent: 69.8,
    anchorYPercent: 26.4,
    pxPerMm: 2.8,
  },
  "amara:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-frontal-ring-v2.png",
    anchorXPercent: 73.3,
    anchorYPercent: 62.0,
    pxPerMm: 2.8,
  },
  "amara:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-dreiviertelprofil-ring-v2.png",
    anchorXPercent: 68.8,
    anchorYPercent: 51.1,
    pxPerMm: 2.8,
  },
  "amara:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-seitlich-ring-v2.png",
    anchorXPercent: 60.1,
    anchorYPercent: 44.1,
    pxPerMm: 2.8,
  },
  "amara:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-frontal-ohr-v2.png",
    anchorXPercent: 67.4,
    anchorYPercent: 26.0,
    pxPerMm: 2.9,
  },
  "amara:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-dreiviertelprofil-ohr-v2.png",
    anchorXPercent: 66.9,
    anchorYPercent: 26.0,
    pxPerMm: 2.8,
  },
  "amara:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-seitlich-ohr-v2.png",
    anchorXPercent: 63.5,
    anchorYPercent: 25.4,
    pxPerMm: 2.8,
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

// Diamond-Group-Freisteller-Fotos für Ohrschmuck (Ohrstecker) zeigen in EINEM Bild oft zwei
// Ansichten DESSELBEN Einzelstücks nebeneinander: Vorderansicht links, Rückseite mit Steg/
// Schmetterlingsverschluss rechts - KEIN Paar, nur eine zweite Ansicht. Fund 2026-08-24: an 3
// verschiedenen Ohrschmuck-Produkten stichprobenartig geprüft (2G386W8, 2Y112G8, 2J666W8), bei
// allen dreien dieselbe Anordnung. Ohne Gegenmaßnahme erfasst detectMotifBoundingBox() die VOLLE
// Bounding Box (beide Ansichten zusammen) und montiert sie als EIN Motiv auf das Ohr - sichtbar im
// Ergebnis als zwei Ohrringe auf einem Ohr statt einem. Fix: bei Ohrschmuck zuerst nur die linke
// Bildhälfte auf ein Motiv hin untersuchen (die Vorderansicht liegt in allen bisher geprüften
// Beispielen konsistent links); schlägt das fehl (z.B. ein Produktfoto ohne diese Konvention, oder
// eine Kreole/ein Ohrring ohne zweite Ansicht), fällt resolvePendantCrop() unten auf die normale
// Ganzbild-Erkennung zurück statt zu raten. Nicht für andere Kategorien angewendet - bei Ring/
// Colliers bisher nicht beobachtet, könnte aber bei künftigen Stichproben ebenfalls auftreten.
async function resolveOhrschmuckCrop(productBuffer: Buffer): Promise<MotifCropOverride | null> {
  const sharp = await loadSharp();
  const meta = await sharp(productBuffer).metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;
  if (!fullWidth || !fullHeight) return null;
  const halfWidth = Math.floor(fullWidth / 2);
  const leftHalf = await sharp(productBuffer)
    .extract({ left: 0, top: 0, width: halfWidth, height: fullHeight })
    .png()
    .toBuffer();
  const detected = await detectMotifBoundingBox(leftHalf);
  if (!detected) return null;
  // Sicherheitscheck: reicht das erkannte Motiv fast bis an den rechten Rand der linken Hälfte
  // heran, wurde es dort vermutlich nicht durch eigenen Freiraum begrenzt, sondern von UNS
  // abgeschnitten (Produkt ohne die Vorderansicht-links/Rückseite-rechts-Konvention, Motiv geht
  // über die Bildmitte hinaus) - dann lieber auf die normale Ganzbild-Erkennung zurückfallen statt
  // ein halbiertes Motiv zu montieren.
  const cutOff = detected.left + detected.width > halfWidth * 0.95;
  return cutOff ? null : detected;
}

// Fund 2026-08-23 (Nutzer-Report zu 4P765G8, ein Collier mit zwei parallelen Pavé-Strängen, die
// in zwei Tropfen-Diamant-Clustern enden): detectMotifBoundingBox() erfasst bei einem NORMALEN
// Collier-Freisteller (echte Transparenz, KEIN deckender Studio-Hintergrund wie bei 4R267R8) die
// GESAMTE sichtbare Kette+Anhänger-Spanne als "das Motiv" - bei 4P765G8 waren das 87% der
// Bildhöhe. compositeRaw() skaliert diese komplette Box (Kette inklusive) auf motifSizeMm() (die
// reale Anhänger-Höhe aus den Produktdaten, hier 22,1mm) - der eigentliche Anhänger, nur ein
// Bruchteil dieser Box, landet dadurch bei etwa 5-6mm: winzig und auf dem Modelfoto kaum als
// Design erkennbar, genau das vom Nutzer gemeldete "Schmuckstück passt überhaupt nicht". Der
// einzige bisher end-to-end getestete Collier-Artikel (4R267R8) hat dieses Problem NIE gezeigt,
// aber nur zufällig: sein Freisteller hat einen deckenden Hintergrund, wodurch trim() kaum
// greift und detectMotifBoundingBox() null zurückgibt - das zwingt zum manuellen Override in
// PRODUCT_MOTIF_OVERRIDES, der zufällig nur den Anhänger selbst erfasst. Jeder ANDERE Collier mit
// echter Transparenz (vermutlich die meisten) war dadurch nie wirklich getestet und lief still in
// denselben Fehler.
//
// Fix: die Kette algorithmisch VOM Anhänger trennen, statt für jedes betroffene Produkt einen
// manuellen Crop zu pflegen (das skaliert nicht). Kernidee: eine reine Kettenzeile hat trotz ggf.
// großer Spannweite (zwei auseinanderlaufende Stränge) nur wenig tatsächlich deckendes Material
// (dünner Draht) - die Anzahl deckender Pixel pro Bildzeile bleibt niedrig und über viele Zeilen
// hinweg erstaunlich konstant. Sobald der Anhänger beginnt (Fassung, Pavé, Cluster, ein breiter
// massiver Bügel wie bei 4Q874W8, ...), springt diese Zeilen-Pixelzahl deutlich nach oben. Die
// erste Zeile, ab der das für mehrere Zeilen in Folge anhält, markiert die Grenze Kette→Anhänger.
//
// Kalibriert und gegengeprüft an 7 echten Colliers unterschiedlichster Bauart (4P765G8, 4R267R8-
// Stil sowie 6 zufällige Stichproben: Solitär+Öse, Halo mit breitem massivem Bügel, Oval-Rahmen
// mit Blütenzweig, Schmetterling mit ZWEI Kettenansätzen direkt an den Flügeln statt einer Öse,
// Perle, Blüten-Cluster) - der erkannte Ausschnitt wurde jeweils gegen das Seitenverhältnis aus
// den Produktdaten (Höhe/Breite in mm) geprüft, Abweichung durchgehend unter 10%. Ein einziger
// Ausreißer während der Kalibrierung (4Q874W8, -50%): der Bügel dort ist breit/massiv (hohe
// Zeilen-Pixelzahl), gefolgt von einem SCHMALEN, kurzen Verbindungssteg zur Fassung (fast so
// dünn wie reine Kette) - ein zu strenges "Zeilen müssen 15 in Folge über dem Schwellwert bleiben"
// hat dadurch fälschlich erst am Cluster ausgelöst statt am Bügel. Behoben durch WINDOW=10 statt
// 15 und einen niedrigeren Multiplikator (2.0 statt 2.5) - beides zusammen erkennt den Bügel
// zuverlässig, ohne bei den anderen 6 Produkten neue Fehlklassifikationen zu erzeugen.
async function resolveColliersPendantCrop(productBuffer: Buffer): Promise<MotifCropOverride | null> {
  const sharp = await loadSharp();
  const ALPHA_THRESHOLD = 30;
  const { data, info } = await sharp(productBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height) return null;

  const rowOpaqueCount = new Array(height).fill(0);
  const rowLeft = new Array(height).fill(-1);
  const rowRight = new Array(height).fill(-1);
  for (let y = 0; y < height; y++) {
    let count = 0;
    let left = -1;
    let right = -1;
    const rowOffset = y * width * channels;
    for (let x = 0; x < width; x++) {
      const alpha = data[rowOffset + x * channels + 3];
      if (alpha > ALPHA_THRESHOLD) {
        count++;
        if (left === -1) left = x;
        right = x;
      }
    }
    rowOpaqueCount[y] = count;
    rowLeft[y] = left;
    rowRight[y] = right;
  }

  // Baseline für "reine Kette" = 20. Perzentil aller Zeilen mit Material - robust gegen einzelne
  // breite Ausreißer (z.B. eine Öse ganz oben), weil bei einem hängenden Anhänger die deutliche
  // Mehrheit der Zeilen echte Kette ist.
  const nonZeroCounts = [...rowOpaqueCount].filter((c) => c > 0).sort((a, b) => a - b);
  if (nonZeroCounts.length === 0) return null;
  const chainBaseline = nonZeroCounts[Math.floor(nonZeroCounts.length * 0.2)];
  const threshold = chainBaseline * 2.0;

  const WINDOW = 10;
  let transitionY = -1;
  for (let y = 0; y <= height - WINDOW; y++) {
    let allAboveThreshold = true;
    for (let w = 0; w < WINDOW; w++) {
      if (rowOpaqueCount[y + w] <= threshold) {
        allAboveThreshold = false;
        break;
      }
    }
    if (allAboveThreshold) {
      transitionY = y;
      break;
    }
  }
  if (transitionY === -1) return null;

  const firstOpaqueY = rowOpaqueCount.findIndex((c) => c > 0);
  const lastOpaqueY = height - 1 - [...rowOpaqueCount].reverse().findIndex((c) => c > 0);
  // Sicherheitscheck (analog zu detectMotifBoundingBox()/resolveOhrschmuckCrop()): bleibt vom
  // gefundenen Übergang bis zum unteren Bildrand nur ein winziger Rest der gesamten Motiv-Höhe
  // übrig, ist das vermutlich eine Fehlerkennung (z.B. ein zufälliger Ausreißer statt der echten
  // Anhänger-Grenze) - dann lieber null zurückgeben und auf die normale Ganzbild-Erkennung
  // zurückfallen statt einen sinnlos schmalen Ausschnitt zu montieren.
  const totalMotifHeight = lastOpaqueY - firstOpaqueY;
  if (lastOpaqueY - transitionY < totalMotifHeight * 0.05) return null;

  let cropLeft = Infinity;
  let cropRight = -Infinity;
  for (let y = transitionY; y <= lastOpaqueY; y++) {
    if (rowLeft[y] !== -1 && rowLeft[y] < cropLeft) cropLeft = rowLeft[y];
    if (rowRight[y] !== -1 && rowRight[y] > cropRight) cropRight = rowRight[y];
  }
  if (!Number.isFinite(cropLeft) || !Number.isFinite(cropRight)) return null;

  return {
    left: cropLeft,
    top: transitionY,
    width: cropRight - cropLeft,
    height: lastOpaqueY - transitionY,
  };
}

async function resolvePendantCrop(
  product: SourceProductRow,
  productBuffer: Buffer,
): Promise<MotifCropOverride> {
  const override = PRODUCT_MOTIF_OVERRIDES[product.modellErweitert];
  if (override) return override;
  if (product.hauptkategorie === "Ohrschmuck") {
    const ohrschmuckCrop = await resolveOhrschmuckCrop(productBuffer);
    if (ohrschmuckCrop) return ohrschmuckCrop;
  }
  if (product.hauptkategorie === "Colliers" || product.hauptkategorie === "Anhänger") {
    const colliersCrop = await resolveColliersPendantCrop(productBuffer);
    if (colliersCrop) return colliersCrop;
  }
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

// Fund 2026-08-26 (Nutzer-Report zu 4L938W8, ein 7x7mm-Anhänger): der reine feste mm-Floor oben
// wurde nur für den 11mm-Referenzfall (4R267R8) kalibriert/freigegeben - bei 7mm ergibt derselbe
// starre Floor (17mm) eine Vergrößerung um das 2,43-fache linear (≈5,9-fache Fläche), deutlich mehr
// als die dort beabsichtigte "leichte" Vergrößerung, und wirkt entsprechend sichtbar überdimensioniert
// ("doppelt so groß" laut Nutzer). MAX_RENDER_ENLARGEMENT_RATIO deckelt das Verhältnis
// stattdessen auf exakt das am 11mm-Fall gebilligte Maß (17/11) - für alles ab 11mm ändert sich
// dadurch NICHTS (bestätigt gegengerechnet gegen alle bisher verifizierten Testprodukte: 4R267R8/
// 11mm, 1JX45W852/14mm, 2G386W8/15mm, 4P765G8/22mm bleiben exakt wie zuvor), nur Motive deutlich
// unter 11mm werden jetzt proportional sanfter statt pauschal auf 17mm angehoben.
const MAX_RENDER_ENLARGEMENT_RATIO = MIN_RENDER_MM / 11;

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
  /**
   * Exaktes Pixel-Rechteck, in das der Anhänger eingesetzt wurde (im Basisfoto-Koordinatensystem).
   * Wird von compositeJewelryVariant() nach dem KI-Kettenschritt gebraucht, um den Vision-Check
   * (siehe verifyPendantIntact() in text-generation.ts, aufgerufen über pendantCheckWindow() hier)
   * auf den richtigen Bildbereich einzugrenzen.
   */
  pasteRect: MotifCropOverride;
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
  // Abmessung, siehe motifSizeMm() in image-generation.ts; effectiveMm siehe MIN_RENDER_MM/
  // MAX_RENDER_ENLARGEMENT_RATIO oben). Ab motifMm >= 11mm identisch zum reinen Max(…, 17)-Floor
  // von vorher (siehe Herleitung dort), darunter proportional gedeckelt statt hart auf 17mm.
  const effectiveMm =
    motifMm >= MIN_RENDER_MM ? motifMm : Math.min(MIN_RENDER_MM, motifMm * MAX_RENDER_ENLARGEMENT_RATIO);
  const pendantLongerPx = Math.max(pendantCrop.width, pendantCrop.height);
  const targetLongerPx = effectiveMm * calibration.pxPerMm;
  const scaleFactor = targetLongerPx / pendantLongerPx;
  const targetW = Math.max(1, Math.round(pendantCrop.width * scaleFactor));
  const targetH = Math.max(1, Math.round(pendantCrop.height * scaleFactor));
  // sharpen() nach dem Resize: bei sehr kleinen Zielgrößen (z.B. ein 14mm-Ringkopf auf ~50px bei
  // pxPerMm~2.9, siehe MIN_RENDER_MM) verwäscht ein reines resize() feine Details (Pavé-Diamanten,
  // Krappen) zu einem unscharfen Fleck - deutlich sichtbar bei einem ersten Test-Rendering
  // (Sophia/Ring, 2026-08-23). Ein moderater Schärfungs-Pass danach stellt eher wahrnehmbare
  // Kanten/Facetten wieder her, ohne Artefakte zu erzeugen - kommt allen Kategorien zugute, nicht
  // nur Ring.
  const resizedPendant = await sharp(cropped).resize(targetW, targetH).sharpen({ sigma: 1 }).png().toBuffer();

  // Licht-/Farbangleichung ans Foto (Nutzer-Feedback 2026-08-25): das Produktfoto ist eine flach/
  // hell ausgeleuchtete Studio-Freistelleraufnahme (harte Facetten-Schwarz/Weiß-Kontraste, neutral-
  // kühler Weißabgleich) - unverändert eingesetzt wirkt der Anhänger/Ring/Ohrring im direkten
  // Vergleich zum weich/warm beleuchteten Model-Foto ("Golden Hour", siehe
  // SYSTEM_INSTRUCTIONS_BEFORE_CLOTHING in image-generation.ts) zu kräftig/aufgesetzt statt vom
  // selben Licht getroffen. Feste, bewusst zurückhaltende Korrektur (kein Re-Lighting, keine
  // Verwischung) statt eines KI-Schritts: Kontrastspanne leicht zurückgenommen (a<1, hebt Tiefen an/
  // senkt Lichter ab) plus warmer Versatz (b: mehr Rot/Grün, kaum Blau) und minimal reduzierte
  // Sättigung. NUR auf die RGB-Kanäle angewendet (removeAlpha()/joinChannel() davor/danach) - würde
  // man die Maske selbst mit anfassen, bekäme der eigentlich transparente Freisteller-Hintergrund
  // einen sichtbaren Schleier statt unverändert transparent zu bleiben.
  const pendantAlpha = await sharp(resizedPendant).ensureAlpha().extractChannel(3).raw().toBuffer();
  const gradedRgb = await sharp(resizedPendant)
    .removeAlpha()
    .modulate({ saturation: 0.85 })
    .linear([0.8, 0.8, 0.76], [22, 13, 3])
    .png()
    .toBuffer();
  const litPendant = await sharp(gradedRgb)
    .joinChannel(pendantAlpha, { raw: { width: targetW, height: targetH, channels: 1 } })
    .png()
    .toBuffer();

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
      { input: litPendant, left: pasteLeft, top: pasteTop },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    attachPoint: { x: anchorX, y: pasteTop },
    pasteRect: { left: pasteLeft, top: pasteTop, width: targetW, height: targetH },
  };
}

// Absicherung gegen das oben dokumentierte Risiko ("die Maske ist bei gpt-image-1.5 KEINE harte
// Pixel-Garantie"): EIN VERWORFENER ERSTER ANSATZ (2026-08-25, siehe Git-Historie) hat versucht,
// das rein über Bildstatistik zu erkennen (Graustufen-Kontrast/Helligkeitsfläche im exakten
// Anhänger-Rechteck vorher/nachher). An den zwei bekannten echten Fällen von 4P765G8 (Frontal =
// intakt, Dreiviertelprofil = sichtbar auf einen Bruchteil geschrumpft) lieferten DREI verschiedene
// Statistik-Varianten widersprüchliche oder sogar verkehrte Ergebnisse - u.a. weil Hautstruktur/
// Stoffgewebe/Kleidungs-Highlights zufällig ähnlichen lokalen Kontrast erzeugen wie echte Pavé-
// Fassungen, UND weil sich herausstellte, dass die KI den Anhänger auch beim intakten Frontal-Fall
// sichtbar verschiebt (nicht nur die Kette anpasst) - ein fester Pixel-Rechteck-Vergleich ist der
// falsche Ansatz. Stattdessen: ein echter semantischer Vision-Check per Claude (siehe
// verifyPendantIntact() in text-generation.ts) auf einem großzügig ausgeschnittenen Bereich um den
// Ankerpunkt (toleriert Verschiebung), der inhaltlich beurteilt statt Pixel zu vergleichen.
function pendantCheckWindow(
  pasteRect: MotifCropOverride,
  canvasWidth: number,
  canvasHeight: number,
): MotifCropOverride {
  // Großzügig das 4-fache der Anhänger-Breite/Höhe als Rand in jede Richtung - deckt die in der
  // Praxis beobachtete Verschiebung (siehe Kommentar oben) mit reichlich Puffer ab, bleibt aber
  // klein genug, um nicht versehentlich Gesicht/Haare mit ins Bild zu bekommen.
  const marginX = pasteRect.width * 4;
  const marginY = pasteRect.height * 4;
  const left = Math.max(0, pasteRect.left - marginX);
  const top = Math.max(0, pasteRect.top - marginY);
  const right = Math.min(canvasWidth, pasteRect.left + pasteRect.width + marginX);
  const bottom = Math.min(canvasHeight, pasteRect.top + pasteRect.height + marginY);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

// Erster Versuch + maximal 2 Wiederholungen - jeder Versuch ist ein echter, kostenpflichtiger
// OpenAI-Aufruf (plus ein günstiger Claude-Vision-Check), daher bewusst knapp gehalten statt
// beliebig oft zu retryen.
const MAX_CHAIN_ATTEMPTS = 3;

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
// buildChainMask()) eine Kette, die vom Hals zum bereits eingesetzten Anhänger führt.
//
// WICHTIGER VORBEHALT (siehe Kommentar oben im Datei-Header): die Maske ist bei gpt-image-1.5 keine
// harte Pixel-Garantie - ein Pixelvergleich zeigt leichte Abweichungen auch außerhalb des Korridors
// (globale Neu-Belichtung). Der Anhänger bleibt dadurch NICHT zu 100% pixelgenau erhalten, nur mit
// hoher Wahrscheinlichkeit weitgehend unverändert. Bewusste Nutzerentscheidung (2026-08-23):
// bestmögliche Optik hat Vorrang vor der harten Größen-Garantie des reinen Mathematik-Wegs.
// NUR EIN Bild (pendantOnlyBuffer), bewusst OHNE das rohe Produktfoto als zweites Referenzbild -
// Fund 2026-08-23: mit dem Produktfoto als zweitem Bild hat gpt-image-1.5 nicht nur die Kette
// gezeichnet, sondern die komplette Bildkomposition verworfen (Pose/Gesicht/Hintergrund neu
// generiert, in einem Fall sogar auf den TRANSPARENTEN Hintergrund des Produktfotos zurückgesetzt) -
// es hat sich also nicht nur inhaltlich, sondern auch stilistisch am zweiten (posenlosen,
// teils transparenten) Produktfoto orientiert, nicht nur an der Maske. Ohne zweites Bild bleibt die
// Pose (Gesicht, Haare, Kleidung, Hintergrund) zuverlässig erhalten - Material/Farbe UND jetzt auch
// die tatsächliche Gliederform kommen ausschließlich per Textbeschreibung rein: materialLabel
// (Katalogdaten) plus chainStyleHint, eine separate Vision-Kurzbeschreibung DER ECHTEN KETTE aus dem
// Produktfoto (siehe describeChainForImagePrompt() in text-generation.ts) - liefert die optische
// Nähe zum echten Produkt, die vorher am zweiten Bild scheiterte, ohne dessen Risiko einzugehen.
//
// FUND 2026-08-25 (Nutzer-Feedback): die generierte Kette wirkte gegenüber dem Rest des Fotos zu
// neutral/gleichmäßig beleuchtet statt in dessen warmem Golden-Hour-Licht - Prompt zitiert deshalb
// jetzt explizit dieselbe Licht-Formulierung wie SYSTEM_INSTRUCTIONS_BEFORE_CLOTHING in
// image-generation.ts (Lichtrichtung, Farbtemperatur, Kantenlicht), statt nur generisch "realistischer
// Metallglanz" zu fordern.
async function generateChainViaMask(
  pendantOnlyBuffer: Buffer,
  maskBuffer: Buffer,
  materialLabel: string | null,
  chainStyleHint: string | null,
  apiKey: string,
): Promise<{ buffer: Buffer; usage: unknown }> {
  const materialHint = materialLabel ? ` aus ${materialLabel} (warmes Roségold)` : "";
  const styleHint = chainStyleHint
    ? ` Die Kette entspricht genau dieser Beschreibung des tatsächlichen Produkts: "${chainStyleHint}".`
    : "";
  const prompt =
    "Kontext: professionelle E-Commerce-Schmuckfotografie, seriös, nicht sexualisiert. Zeichne NUR " +
    "im transparenten/editierbaren Bereich der Maske eine dünne, elegante Halskette (Ankerkette/" +
    `Cable-Kette)${materialHint}, die natürlich vom Hals kommend zu dem bereits vorhandenen ` +
    `Anhänger führt und dort ansetzt, keine übertriebene Dicke.${styleHint} Beleuchtung der Kette ` +
    "GENAU wie im Rest des Fotos: warmes 'Golden Hour'/Champagnerlicht, weiches Beauty-Light von " +
    "links oben, warme Farbtemperatur, feines Kantenlicht auf dem Metall, sanfte Schatten - keine " +
    "neutrale/kühle Studiobeleuchtung, keine eigene Lichtquelle für die Kette. KRITISCH: Das " +
    "Ausgabebild muss EXAKT denselben Bildausschnitt, dieselbe Kopfhaltung, denselben Zoom/Crop und " +
    "denselben Hintergrund wie das gegebene Bild behalten - vergrößere/verkleinere/beschneide " +
    "NICHTS. Der Rest des Bildes (Gesicht, Haare, Kleidung, Hintergrund, der bereits platzierte " +
    "Anhänger) ist durch die Maske geschützt - verändere dort nichts. Kein zusätzlicher Schmuck.";

  const [pendantFile, maskFile] = await Promise.all([
    toFile(pendantOnlyBuffer, "pendant-only", { type: "image/png" }),
    toFile(maskBuffer, "mask", { type: "image/png" }),
  ]);

  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const response = await client.images.edit({
    image: [pendantFile],
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
  const { buffer: pendantOnly, attachPoint, pasteRect } = await compositeRaw(
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
  // Reiner Text-Stilhinweis aus einer separaten Vision-Analyse des echten Produktfotos (siehe
  // describeChainForImagePrompt()) - KEIN zweites Bild geht in generateChainViaMask() ein, das war
  // bereits einmal die Ursache für eine verworfene Bildkomposition (siehe Kommentar dort). Darf
  // scheitern/leer bleiben (fehlender API-Key, unklare Kette auf dem Foto) - die Ketten-Generierung
  // fällt dann auf den bisherigen generischen Materialhinweis zurück statt abzubrechen.
  const chainStyleHint = await describeChainForImagePrompt(
    productBuffer,
    guessMimeType(refUrl) as "image/jpeg" | "image/png" | "image/webp",
    product.id,
  ).catch((err) => {
    console.error("[image-compositing] Ketten-Stilanalyse fehlgeschlagen, nutze generischen Hinweis:", err);
    return null;
  });
  // Absicherung (Fund 2026-08-25 an 4P765G8): die Maske ist keine harte Garantie, die KI kann den
  // bereits korrekt platzierten Anhänger sichtbar mit-überschreiben/schrumpfen/verschieben. Statt
  // das blind auszuliefern, wird jeder Versuch per Claude-Vision-Check (verifyPendantIntact(), siehe
  // pendantCheckWindow() oben) geprüft und bei einem offensichtlich zerstörten Anhänger bis zu
  // MAX_CHAIN_ATTEMPTS-mal neu generiert (jeder Versuch ein echter, kostenpflichtiger OpenAI-Aufruf,
  // daher knapp begrenzt). Bleibt der Anhänger auch im letzten Versuch kaputt, greift dieselbe
  // Devise wie beim fehlenden API-Key oben: lieber der mathematisch garantiert korrekte Anhänger
  // ohne Kette als ein sichtbar falsches Bild.
  const checkWindow = pendantCheckWindow(pasteRect, baseW, baseH);
  const sharp = await loadSharp();
  const beforeCrop = await sharp(pendantOnly).extract(checkWindow).png().toBuffer();

  let attemptsMade = 0;
  for (let attempt = 1; attempt <= MAX_CHAIN_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    const { buffer: withChain, usage } = await generateChainViaMask(
      pendantOnly,
      mask,
      materialLabel,
      chainStyleHint,
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

    const afterCrop = await sharp(withChain).extract(checkWindow).png().toBuffer();
    // null = Check selbst fehlgeschlagen/kein API-Key -> "fail open" (nicht blockieren), damit ein
    // Claude-Ausfall nicht unnötig OpenAI-Wiederholungen auf Kosten des Nutzers auslöst.
    const intact = await verifyPendantIntact(beforeCrop, afterCrop, product.id).catch((err) => {
      console.error("[image-compositing] Anhänger-Intaktheitscheck fehlgeschlagen, lasse Bild durch:", err);
      return null;
    });
    if (intact !== false) {
      return {
        buffer: withChain,
        prompt: `[Compositing-Weg: Anhänger mathematisch platziert, Kette per KI in maskiertem Korridor, Versuch ${attempt}/${MAX_CHAIN_ATTEMPTS}] ${model.name} - ${poseVariant.label}`,
      };
    }
    console.warn(
      `[image-compositing] Vision-Check meldet beschädigten Anhänger nach KI-Kettenschritt ` +
        `(Versuch ${attempt}/${MAX_CHAIN_ATTEMPTS}, Produkt ${product.modellErweitert}, ` +
        `${model.key}/${poseVariant.key}) - ` +
        (attempt < MAX_CHAIN_ATTEMPTS ? "wiederhole." : "falle auf Anhänger ohne Kette zurück."),
    );
  }

  // Alle Versuche zerstörten den Anhänger sichtbar - Fallback auf den reinen Bildmathematik-Anhänger
  // ohne Kette statt das beste (aber immer noch verdächtige) KI-Ergebnis zu riskieren.
  return {
    buffer: pendantOnly,
    prompt:
      `[Compositing-Weg: mathematisch platziert, KI-Kette nach ${attemptsMade} Versuchen verworfen ` +
      `(Anhänger wurde dabei sichtbar verändert)] ${model.name} - ${poseVariant.label}`,
  };
}
