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
  // Zweites Model für Colliers (erster Schritt der Model-Achse der Erweiterung) - Basisfoto per
  // grid-overlay auf Pupillenabstand (63mm) kalibriert: pxPerMm ergibt sich (zufällig, aber
  // plausibel, da identisches Prompt-Framing/Auflösung wie bei Sophia) zum selben Wert 2.76.
  "claire:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-frontal-hals.png",
    anchorXPercent: 48,
    anchorYPercent: 64,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 31, yPercent: 52 },
    chainRightAnchor: { xPercent: 65, yPercent: 52 },
    referenceChainLengthCm: 45.7,
  },
  // Claire komplettiert (die übrigen 2 von 3 Posen) - ohne diese hätte die UI "Compositing" für
  // Claire zwar angeboten, wäre aber bei genau diesen beiden Posen mit einem Fehler abgebrochen
  // (siehe compositeJewelryVariant()). anchorYPercent weicht hier bewusst von Sophias Werten ab
  // (53%/55% statt 63%/62%) - das jeweilige Basisfoto ist etwas weniger eng zugeschnitten
  // (mehr Oberkörper sichtbar), per Grid-Overlay am tatsächlichen Foto nachgemessen statt von
  // Sophia übernommen.
  "claire:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-dreiviertelprofil-hals.png",
    anchorXPercent: 46,
    anchorYPercent: 53,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 39, yPercent: 44 },
    chainRightAnchor: { xPercent: 74, yPercent: 44 },
    referenceChainLengthCm: 45.7,
  },
  "claire:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-seitlich-hals.png",
    anchorXPercent: 56,
    anchorYPercent: 55,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 27, yPercent: 49 },
    chainRightAnchor: { xPercent: 81, yPercent: 48 },
    referenceChainLengthCm: 45.7,
  },
  // Drittes Model für Colliers - alle 3 Posen direkt zusammen kalibriert. Jens Bob-Frisur (kurz,
  // fällt seitlich am Gesicht statt über den Hals wie bei Sophia/Claire) macht den Hals in allen 3
  // Posen durchgängig gut sichtbar - Ketten-Anker liegen deshalb tendenziell etwas symmetrischer.
  "jen:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-frontal-hals.png",
    anchorXPercent: 49,
    anchorYPercent: 57,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 29, yPercent: 47 },
    chainRightAnchor: { xPercent: 68, yPercent: 47 },
    referenceChainLengthCm: 45.7,
  },
  "jen:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-dreiviertelprofil-hals.png",
    anchorXPercent: 54,
    anchorYPercent: 60,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 27, yPercent: 49 },
    chainRightAnchor: { xPercent: 76, yPercent: 49 },
    referenceChainLengthCm: 45.7,
  },
  "jen:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-seitlich-hals.png",
    anchorXPercent: 45,
    anchorYPercent: 60,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 24, yPercent: 49 },
    chainRightAnchor: { xPercent: 73, yPercent: 49 },
    referenceChainLengthCm: 45.7,
  },
  // Viertes und letztes weibliches Model für Colliers (alle 4 aus der weiblichen Model-DNA jetzt
  // komplett). Amaras Locken sind für dieses Referenzfoto bewusst zurückgestylt (hoher Zopf/Dutt,
  // s. Prompt) statt offen wie sonst beschrieben - sonst wäre der Hals durch das voluminöse Haar
  // verdeckt gewesen. Dadurch liegt der Hals in allen 3 Posen vollständig frei, Ketten-Anker
  // brauchen hier (anders als bei offenen Frisuren) keine "verschwindet im Haar"-Logik, sondern
  // markieren einfach den sichtbaren Halsrand auf Kieferhöhe.
  "amara:frontal:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-frontal-hals.png",
    anchorXPercent: 51,
    anchorYPercent: 61,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 29, yPercent: 42 },
    chainRightAnchor: { xPercent: 73, yPercent: 42 },
    referenceChainLengthCm: 45.7,
  },
  "amara:dreiviertelprofil:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-dreiviertelprofil-hals.png",
    anchorXPercent: 52,
    anchorYPercent: 59,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 27, yPercent: 42 },
    chainRightAnchor: { xPercent: 68, yPercent: 42 },
    referenceChainLengthCm: 45.7,
  },
  "amara:seitlich:Colliers": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-seitlich-hals.png",
    anchorXPercent: 45,
    anchorYPercent: 61,
    pxPerMm: 2.76,
    chainLeftAnchor: { xPercent: 27, yPercent: 46 },
    chainRightAnchor: { xPercent: 64, yPercent: 46 },
    referenceChainLengthCm: 45.7,
  },
  // Erster Schritt der KATEGORIE-Achse der Erweiterung: Ring statt Colliers - andere Körperpartie
  // (Hand statt Hals), deshalb kein chainLeftAnchor/-RightAnchor (kein Ketten-Problem bei einem
  // Ring). compositeJewelryVariant() fällt dadurch automatisch auf den reinen Mathematik-Pfad
  // zurück (kein KI-Aufruf, kostenlos) - siehe dortige Fallback-Logik. Ankerpunkt = Mitte des
  // Ringfinger-Grundglieds (proximale Phalanx), per Grid-Overlay abgelesen; pxPerMm über die
  // Nagellänge des Ringfingers geschätzt (~18mm, Standardwert), NICHT über den Pupillenabstand
  // (auf diesem Foto ist kein Gesicht in Nahaufnahme sichtbar) - deutlich unsicherer als die
  // Pupillen-Kalibrierung bei den Hals-Posen, nach erstem Test-Rendering ggf. nachjustieren.
  "sophia:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-ring.png",
    anchorXPercent: 62,
    anchorYPercent: 49.5,
    pxPerMm: 2.9,
  },
  // Ring komplettiert (die übrigen 2 von 3 Posen) - gleicher Grund wie bei Claire/Colliers: ohne
  // diese hätte die UI "Compositing" für Ring angeboten, wäre aber bei 2 von 3 Posen mit einem
  // Fehler abgebrochen. Die erste dreiviertelprofil-Aufnahme wurde verworfen und neu generiert -
  // die KI hatte die Finger an die Wange gekrümmt statt flach gestreckt, was die Ringfinger-
  // Zuordnung unzuverlässig gemacht hätte (siehe compositionHint in image-facts.ts: "NICHT
  // gekrümmt"). pxPerMm über alle 3 Posen konsistent auf 2.9 gehalten (Mittelwert aus einzeln pro
  // Foto über die Nagellänge geschätzten 2.7-3.1) statt pro Foto zu variieren - gleiche Begründung
  // wie bei den Hals-Posen: ein Produkt soll über seine 3 Varianten hinweg nicht sichtbar die
  // Größe wechseln.
  "sophia:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-ring.png",
    anchorXPercent: 65,
    anchorYPercent: 64,
    pxPerMm: 2.9,
  },
  "sophia:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-ring.png",
    anchorXPercent: 78,
    anchorYPercent: 62,
    pxPerMm: 2.9,
  },
  // Zweite neue Kategorie: Ohrschmuck (Ohr statt Hand) - alle 3 Posen direkt zusammen kalibriert
  // (Lehre aus Claire/Ring: nicht erst 1 Pose und die Lücke später schließen). Kein
  // chainLeftAnchor/-RightAnchor (kein Ketten-Problem), also wieder der kostenlose Mathematik-Pfad.
  // pxPerMm HIER bewusst NICHT über Pupillenabstand ermittelt (anders als bei den Hals-Posen) und
  // auch NICHT über alle 3 Posen hinweg wiederverwendet: alle 3 Ohr-Fotos brauchen zwangsläufig
  // einen gedrehten Kopf (frontal ist ein Ohr nicht sichtbar) - der scheinbare Pupillenabstand wäre
  // also in JEDER Pose unterschiedlich stark perspektivisch verzerrt, eine "Referenzpose" gibt es
  // hier nicht. Stattdessen: Ohrlänge (Helix-Oberkante bis Läppchen-Unterkante), Ø 63mm beim
  // Erwachsenen - wird lokal AM Ohr selbst gemessen, direkt in der Bildebene, weitgehend unabhängig
  // von der Kopfdrehung um die Hochachse. Ergebnis schwankt zwischen den 3 Fotos (2.63-3.08) stärker
  // als bei den anderen Kategorien - vermutlich eher Messungenauigkeit an der weichen, konturarmen
  // Ohrform als ein echter Größenunterschied; deshalb bewusst PRO Foto einzeln gemessen statt einen
  // Wert zu erzwingen. Ankerpunkt = Mitte des Ohrläppchens (wo ein Ohrstecker/-hänger ansetzt).
  "sophia:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-frontal-ohr.png",
    anchorXPercent: 63,
    anchorYPercent: 39,
    pxPerMm: 3.08,
  },
  "sophia:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-dreiviertelprofil-ohr.png",
    anchorXPercent: 62,
    anchorYPercent: 35,
    pxPerMm: 2.63,
  },
  "sophia:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/sophia-seitlich-ohr.png",
    anchorXPercent: 57,
    anchorYPercent: 38,
    pxPerMm: 2.68,
  },
  // Claire ergänzt für Ring und Ohrschmuck (alle 3 Posen je Kategorie zusammen). Bei den Ring-
  // Fotos lagen die Finger enger/leicht überlappend statt klar gespreizt wie bei Sophias Fotos -
  // die Ringfinger-Zuordnung ist hier dadurch unsicherer (weniger klar abgrenzbare Nägel je Foto);
  // nach dem Test-Rendering nochmal gegenprüfen.
  "claire:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-frontal-ring.png",
    anchorXPercent: 68,
    anchorYPercent: 63,
    pxPerMm: 2.7,
  },
  "claire:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-dreiviertelprofil-ring.png",
    anchorXPercent: 52,
    anchorYPercent: 63,
    pxPerMm: 2.7,
  },
  "claire:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-seitlich-ring.png",
    anchorXPercent: 56,
    anchorYPercent: 56,
    pxPerMm: 2.7,
  },
  // KORREKTUR (Remeasure): Die ursprünglichen Werte hier waren fehlerhaft - der Ohrring landete
  // sichtbar zu weit vorne/oben auf Wange/Kieferlinie statt auf dem Ohrläppchen (Test mit 2G386W8).
  // Direkter Bildvergleich (identischer Crop-Ausschnitt) zeigt: Claires und Sophias Ohr-Fotos sind
  // in allen 3 Posen praktisch deckungsgleich geframt (gleiche Ohrgröße, gleiche Kopfposition) -
  // Sophias verifizierter Anker (gleiche Pose) trifft bei Claire exakt denselben anatomischen Punkt
  // (Tragus/Läppchen-Übergang). Deshalb hier bewusst Sophias Werte 1:1 übernommen statt neu (und
  // wieder fehleranfällig) am weichen, konturarmen Ohr zu messen.
  "claire:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-frontal-ohr.png",
    anchorXPercent: 63,
    anchorYPercent: 39,
    pxPerMm: 3.08,
  },
  "claire:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-dreiviertelprofil-ohr.png",
    anchorXPercent: 62,
    anchorYPercent: 35,
    pxPerMm: 2.63,
  },
  "claire:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/claire-seitlich-ohr.png",
    anchorXPercent: 57,
    anchorYPercent: 38,
    pxPerMm: 2.68,
  },
  // Jen ergänzt für Ring und Ohrschmuck (dritte Model, alle 3 Posen je Kategorie zusammen).
  // WICHTIGER Zwischenfall bei der Ring-Generierung: die ersten Versuche für frontal/
  // dreiviertelprofil haben trotz expliziter "KEIN Schmuck jeglicher Art"-Anweisung im Prompt
  // TROTZDEM einen Ring auf die Hand gerendert - die visuelle Assoziation "elegante Hand nahe
  // Schlüsselbein/Kinn = Verlobungsring-Foto" hat die Anweisung offenbar überstimmt. Fix: beide
  // Fotos mit einer zusätzlich vorangestellten, mehrfach wiederholten "AUSDRÜCKLICH KEIN Ring"-
  // Klausel neu generiert (seitlich war beim ersten Versuch bereits schmucklos, musste aber aus
  // einem anderen Grund neu generiert werden - siehe unten). Bei jeder neuen Model/Kategorie-
  // Kombination mit "Hand nahe Gesicht"-Posen also aktiv gegenprüfen, nicht nur auf die Prompt-
  // Klausel vertrauen. Der Direktvergleich-Trick von Claire/Ohrschmuck (Sophias verifizierten
  // Anker übertragen) hat hier NICHT funktioniert - Jens Kopf/Ohr sitzt wegen der anderen Frisur
  // (kurzer Bob statt langer Wellen) sichtbar anders im Bildausschnitt; alle 6 Anker deshalb neu
  // per Grid-Overlay direkt an Jens eigenen Fotos gemessen. pxPerMm mangels verlässlicher
  // Anatomie-Konstante (Ring) bzw. wegen haarbedecktem Helix-Ansatz (Ohrschmuck) auf plausible
  // Schätzwerte im selben Bereich wie Sophia/Claire gesetzt, nach Test-Rendering zu verifizieren.
  "jen:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-frontal-ring.png",
    anchorXPercent: 54,
    anchorYPercent: 62,
    pxPerMm: 2.8,
  },
  "jen:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-dreiviertelprofil-ring.png",
    anchorXPercent: 47,
    anchorYPercent: 60,
    pxPerMm: 2.8,
  },
  // Seitlich musste separat neu generiert werden: der erste Versuch zeigte nur eine einzelne
  // angedeutete Fingerspitze am Kinn statt einer klar erkennbaren, gespreizten Hand (Finger zu
  // stark eingerollt für eine zuverlässige Ringfinger-Zuordnung) - mit einer verstärkten, expliziten
  // "flache Hand auf dem Schlüsselbein"-Anweisung neu generiert (analog zu Claires Referenzpose).
  "jen:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-seitlich-ring.png",
    anchorXPercent: 73,
    anchorYPercent: 66,
    pxPerMm: 2.8,
  },
  "jen:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-frontal-ohr.png",
    anchorXPercent: 75,
    anchorYPercent: 39,
    pxPerMm: 3.0,
  },
  "jen:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-dreiviertelprofil-ohr.png",
    anchorXPercent: 70,
    anchorYPercent: 34,
    pxPerMm: 2.8,
  },
  "jen:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/jen-seitlich-ohr.png",
    anchorXPercent: 72,
    anchorYPercent: 34,
    pxPerMm: 2.8,
  },
  // Amara ergänzt für Ring und Ohrschmuck (viertes und letztes weibliches Model, alle 3 Posen je
  // Kategorie zusammen). Lehren aus Jen von Anfang an eingebaut: verstärkte "AUSDRÜCKLICH KEIN
  // Ring"-Klausel im Prompt (trotzdem einmal ein winziger Ohrstecker auf dem RING-Foto durchgerutscht
  // - dort irrelevant, da nur die Hand ausgewertet wird, aber ein Beleg dass die Klausel keine
  // 100%-Garantie ist) sowie explizite "ganze Hand flach, alle 4 Finger sichtbar gespreizt"-Vorgabe
  // - alle 6 Fotos beim ersten Versuch brauchbar, keine Neugenerierung nötig. Alle 3 Ohrschmuck-
  // Fotos gegengeprüft: kein Schmuck am Ohr sichtbar (nur ein harmloses Muttermal auf 2 der 3
  // Fotos). Anker wie immer per Grid-Overlay direkt gemessen (kein Direktvergleich-Trick möglich,
  // andere Frisur/Kopfposition als Sophia/Claire).
  "amara:frontal:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-frontal-ring.png",
    anchorXPercent: 64,
    anchorYPercent: 65,
    pxPerMm: 2.8,
  },
  "amara:dreiviertelprofil:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-dreiviertelprofil-ring.png",
    anchorXPercent: 66,
    anchorYPercent: 57,
    pxPerMm: 2.8,
  },
  "amara:seitlich:Ring": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-seitlich-ring.png",
    anchorXPercent: 68,
    anchorYPercent: 42,
    pxPerMm: 2.8,
  },
  "amara:frontal:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-frontal-ohr.png",
    anchorXPercent: 74,
    anchorYPercent: 37,
    pxPerMm: 2.9,
  },
  "amara:dreiviertelprofil:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-dreiviertelprofil-ohr.png",
    anchorXPercent: 68,
    anchorYPercent: 39,
    pxPerMm: 2.8,
  },
  "amara:seitlich:Ohrschmuck": {
    baseImageUrl:
      "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/pose-base/amara-seitlich-ohr.png",
    anchorXPercent: 63,
    anchorYPercent: 30,
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
  // sharpen() nach dem Resize: bei sehr kleinen Zielgrößen (z.B. ein 14mm-Ringkopf auf ~50px bei
  // pxPerMm~2.9, siehe MIN_RENDER_MM) verwäscht ein reines resize() feine Details (Pavé-Diamanten,
  // Krappen) zu einem unscharfen Fleck - deutlich sichtbar bei einem ersten Test-Rendering
  // (Sophia/Ring, 2026-08-23). Ein moderater Schärfungs-Pass danach stellt eher wahrnehmbare
  // Kanten/Facetten wieder her, ohne Artefakte zu erzeugen - kommt allen Kategorien zugute, nicht
  // nur Ring.
  const resizedPendant = await sharp(cropped).resize(targetW, targetH).sharpen({ sigma: 1 }).png().toBuffer();

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
// NUR EIN Bild (pendantOnlyBuffer), bewusst OHNE das rohe Produktfoto als zweites Referenzbild -
// Fund 2026-08-23: mit dem Produktfoto als zweitem Bild hat gpt-image-1.5 nicht nur die Kette
// gezeichnet, sondern die komplette Bildkomposition verworfen (Pose/Gesicht/Hintergrund neu
// generiert, in einem Fall sogar auf den TRANSPARENTEN Hintergrund des Produktfotos zurückgesetzt) -
// es hat sich also nicht nur inhaltlich, sondern auch stilistisch am zweiten (posenlosen,
// teils transparenten) Produktfoto orientiert, nicht nur an der Maske. Ohne zweites Bild bleibt die
// Pose (Gesicht, Haare, Kleidung, Hintergrund) zuverlässig erhalten, Material/Farbe kommt jetzt
// ausschließlich per Textbeschreibung (materialLabel).
async function generateChainViaMask(
  pendantOnlyBuffer: Buffer,
  maskBuffer: Buffer,
  materialLabel: string | null,
  apiKey: string,
): Promise<{ buffer: Buffer; usage: unknown }> {
  const materialHint = materialLabel ? ` aus ${materialLabel} (warmes Roségold)` : "";
  const prompt =
    "Kontext: professionelle E-Commerce-Schmuckfotografie, seriös, nicht sexualisiert. Zeichne NUR " +
    "im transparenten/editierbaren Bereich der Maske eine dünne, elegante Halskette (Ankerkette/" +
    `Cable-Kette)${materialHint}, die natürlich vom Hals kommend zu dem bereits vorhandenen ` +
    "Anhänger führt und dort ansetzt, mit realistischem Metallglanz und feinen Lichtreflexen, " +
    "keine übertriebene Dicke. KRITISCH: Das Ausgabebild muss EXAKT denselben Bildausschnitt, " +
    "dieselbe Kopfhaltung, denselben Zoom/Crop und denselben Hintergrund wie das gegebene Bild " +
    "behalten - vergrößere/verkleinere/beschneide NICHTS. Der Rest des Bildes (Gesicht, Haare, " +
    "Kleidung, Hintergrund, der bereits platzierte Anhänger) ist durch die Maske geschützt - " +
    "verändere dort nichts. Kein zusätzlicher Schmuck.";

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
  const { buffer: withChain, usage } = await generateChainViaMask(pendantOnly, mask, materialLabel, apiKey);

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
