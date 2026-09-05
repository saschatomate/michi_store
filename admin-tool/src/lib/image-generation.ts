import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import {
  bodyPartMapping,
  assignModel,
  MARINELL_MODELS,
  type BodyPartMapping,
  type MarinellModel,
  type ModelGender,
  type PoseVariant,
} from "@/lib/image-facts";
import { estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";
import { diamondSlots, coloredStoneSlots } from "@/lib/product-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

const OPENAI_IMAGE_MODEL = "gpt-image-1.5";

// MARINELL Editorial-Fotografie (aus "01 MARINELL Brand DNA.docx"): leise, warme, zeitlose
// Bildsprache statt lauter Statussymbolik. Großzügiger, eleganter Bildausschnitt, der spürbar mehr
// vom Model zeigt als ein reines Produkt-Makrofoto - keine isolierte Hand/Ohr/Hals-Nahaufnahme vor
// leerem Hintergrund.
const SYSTEM_INSTRUCTIONS_BEFORE_CLOTHING =
  // Explizites Kontext-/Zweck-Framing an erster Stelle: hilft OpenAIs Sicherheitssystem (Prompt- +
  // Bild-Moderation vor jeder gpt-image-Generierung), den nahen Bildausschnitt korrekt als seriöse
  // Produktfotografie statt als sinnliche/erotische Aufnahme einzuordnen. Wurde ergänzt, nachdem ein
  // echter Aufruf mit safety_violations=[sexual] abgelehnt wurde.
  "Kontext: Dies ist professionelle E-Commerce-/Katalog-Produktfotografie für eine seriöse " +
  "Fine-Jewellery-Marke, ausschließlich zur Präsentation eines einzelnen Schmuckstücks am Körper " +
  "(vergleichbar mit Tiffany & Co., Cartier oder Van Cleef & Arpels Kampagnenbildern). KEINE " +
  "erotische, sexualisierte, anzügliche oder freizügige Darstellung - das Model ist vollständig " +
  "und dezent bekleidet, Pose und Ausdruck sind neutral-elegant wie in einem Modemagazin- oder " +
  "Werbekatalog-Shooting, nicht intim oder suggestiv. " +
  "MARINELL Editorial-Luxus-Schmuckfotografie: 'Luxury, lived discreetly' - die Bildsprache ist " +
  "leise, ruhig, nie laut oder aufdringlich. Sie transportiert Ruhe, Eleganz, Wärme, Vertrauen und " +
  "Zeitlosigkeit - NICHT Status, Reichtum oder Dekadenz. Großzügiger, eleganter Bildausschnitt, " +
  "der deutlich mehr vom Model zeigt als eine isolierte Nahaufnahme nur des Schmuckstücks - je " +
  "nach Schmuckart z.B. Teile von Kinn/Mund, Hals, Schulter oder Oberkörper mit im Bild, dabei " +
  "immer vollständig und nicht freizügig bekleidet. Das Schmuckstück bleibt scharf im Fokus, alles " +
  "andere (Haare, Hintergrund, entferntere Hautpartien) durch geringe Schärfentiefe (Bokeh) leicht " +
  "unscharf. Hintergrund: champagnerfarbener " +
  "Seiden-/Satinvorhang mit weichen Falten, oder alternativ ein warmer, heller Sandton-Studiohintergrund " +
  "ohne sichtbare Struktur oder Requisiten - Farbwelt durchgehend Ivory, Champagne, Warm Sand, " +
  "Cashmere, Black, Warm Gold, Soft Taupe. Licht: warmes 'Golden Hour'/Champagnerlicht - großes, " +
  "weiches Beauty-Light von links oben, warme Farbtemperatur, feines Kantenlicht, sanfte Schatten, " +
  "keine harten Reflexe. Der Fokus liegt auf dem Schmuckstück statt auf einem vollständigen " +
  "Beauty-Porträt - das Gesicht muss nicht komplett im Bild sein (z.B. nur Kinn/Wange sichtbar), " +
  "wirkt dabei aber immer natürlich und beiläufig, NICHT bewusst anonymisiert oder abgeschnitten " +
  "wirkend. Ruhige, unaufdringliche, professionelle Ausstrahlung. ";

// Kleidung ist bewusst NICHT Teil von SYSTEM_INSTRUCTIONS, sondern hängt vom Geschlecht des
// zugewiesenen Models ab (seit Einführung der männlichen Gegenstücke Adrian/Luca/Kenji/Malik) -
// ein Kleid wäre bei einem männlichen Model falsch. Beide Varianten bleiben in derselben
// Farbwelt/Materialität wie der Rest der Bildsprache (Seide, Kaschmir, Schwarz, Champagner).
// "Slip-Kleid" wurde bewusst zu "Abendkleid mit schmalen Trägern" geändert - das Wort "Slip" kann
// von einer Bild-/Text-Moderation (auch bei englischsprachiger Auswertung eines deutschen Prompts)
// als Dessous/Nachtwäsche statt als Kleidungsstil gelesen werden.
const CLOTHING_BY_GENDER: Record<ModelGender, string> = {
  weiblich:
    "Kleidung: schwarzes seidenes Abendkleid mit schmalen Trägern, champagnerfarbenes Satinkleid " +
    "oder cremefarbener Kaschmir/Blazer - schlicht, ohne Muster oder Logos, die nicht vom " +
    "Schmuckstück ablenken. Kleidung sitzt immer vollständig bedeckend, nicht durchsichtig und " +
    "nicht freizügig. ",
  männlich:
    "Kleidung: cremefarbener Kaschmir-/Rollkragenpullover, offenes weißes oder schwarzes " +
    "Leinenhemd oder schlicht geschnittener schwarzer Blazer - schlicht, ohne Muster oder Logos, " +
    "die nicht vom Schmuckstück ablenken. ",
};

const SYSTEM_INSTRUCTIONS_AFTER_CLOTHING =
  "Natürliche Retusche: echte Hautstruktur mit " +
  "sichtbaren Poren und ggf. dezenten Sommersprossen bleibt erhalten, keine Plastikhaut, keine " +
  "übertriebene Beauty-Retusche. Ruhige editorial Farbgebung mit sanftem Kontrast. Kein Text, kein " +
  "Logo, kein Wasserzeichen im Bild. " +
  "KRITISCH bei zusätzlichem Schmuck: Außer dem einen abgebildeten Referenzstück ist AUSSCHLIESSLICH " +
  "kein weiteres Schmuckstück im Bild sichtbar - keine Ohrringe, keine Kette/kein Anhänger, keine " +
  "Ringe, keine Armbänder/Armreifen, keine Uhr -, auch nicht dezent, teilweise verdeckt oder nur " +
  "angedeutet. Sind Ohren, Hals, Hände oder Handgelenke im Bild sichtbar, aber nicht die " +
  "Körperpartie mit dem Referenzstück, bleiben sie komplett schmucklos. " +
  "Verändere das Schmuckstück selbst NICHT - Form, Fassung, Steinanzahl und Material " +
  "müssen exakt wie im Referenzbild bleiben. Spiegle oder drehe das Schmuckstück NICHT - " +
  "Vorderseite, Rückseite sowie Innen- und Außenseite müssen exakt wie im Referenzbild ausgerichtet " +
  "bleiben. Generiere nur die Körperpartie und die Umgebung drumherum. " +
  "KRITISCH bei Proportionen: Skaliere das gesamte Schmuckstück proportional zur tatsächlichen " +
  "Anatomie und zur Bildperspektive des Models, sodass seine reale Größe am Finger, Ohr, Hals oder " +
  "Handgelenk glaubwürdig und maßstabsgetreu erscheint - orientiere dich an realistischen " +
  "menschlichen Größenverhältnissen (z.B. Fingerbreite, Ohrläppchengröße, Handgelenksumfang) statt " +
  "das Schmuckstück zur besseren Bildwirkung zu vergrößern oder zu verkleinern, auch wenn das " +
  "freigestellte Referenzfoto des Schmuckstücks selbst keine Größenreferenz enthält. " +
  "KRITISCH bei Händen: Die Hand muss anatomisch absolut korrekt sein - genau fünf Finger inklusive " +
  "sichtbarem Daumen, jeder Finger einzeln und klar voneinander getrennt, natürliche Proportionen " +
  "und Gelenke. Vermeide stark gekrümmte, verschränkte oder zur Faust geballte Fingerhaltungen, bei " +
  "denen Finger übereinander- oder ineinanderliegen - das führt zu Fehlern wie verschmolzenen " +
  "Fingern oder einem fehlenden Daumen. Bei Ringen: Der Ring sitzt vollständig auf GENAU EINEM " +
  "Finger und umschließt nur diesen einen Finger - er darf niemals zwei Finger überbrücken, " +
  "verbinden oder wie ein Steg zwischen zwei Fingern wirken.";

function systemInstructionsFor(gender: ModelGender): string {
  return SYSTEM_INSTRUCTIONS_BEFORE_CLOTHING + CLOTHING_BY_GENDER[gender] + SYSTEM_INSTRUCTIONS_AFTER_CLOTHING;
}

export function referenceImageUrl(product: SourceProductRow): string | null {
  if (product.freistellerUrl) return product.freistellerUrl;
  if (product.modelbildUrl) return product.modelbildUrl;
  if (product.bildUrls && product.bildUrls.length > 0) return product.bildUrls[0];
  return null;
}

export function guessMimeType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Referenzbild konnte nicht geladen werden (${response.status}): ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Löst das für ein Produkt geltende MARINELL-Model auf - bevorzugt die dauerhaft gespeicherte
// Zuweisung (sourceProducts.assignedModelKey), sonst die Live-Berechnung (z.B. für die
// Prompt-Vorschau, bevor überhaupt einmal generiert wurde).
export function resolveModel(product: SourceProductRow): MarinellModel {
  const key = (product.assignedModelKey as MarinellModel["key"] | null) ?? assignModel(product);
  return MARINELL_MODELS[key];
}

// Der Basis-Prompt (ohne Pose-Zusatz, der pro Variante wechselt) - wird sowohl für die echte
// Generierung als auch zum Vorausfüllen der Prompt-Bearbeiten-Ansicht in der UI verwendet.
export function defaultImageBasePrompt(product: SourceProductRow): string {
  const mapping = bodyPartMapping(product.hauptkategorie);
  if (!mapping) return "";
  const model = resolveModel(product);
  return (
    `${systemInstructionsFor(model.gender)} Das Model in diesem Bild: ${model.physicalDescription} Setze DIESES ` +
    `Schmuckstück (aus dem Referenzbild) unverändert auf ${mapping.bodyPart}. ${mapping.compositionHint}.`
  );
}

function uniqueNonEmpty(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v?.trim())))];
}

// Diamant-Farbgrade sind fast immer Fachcodes der klassischen Skala (D-Z, oder die ältere
// Wesselton-Nomenklatur "TW"/"W"/"F" etc.) - für ein Bildmodell bedeutungslos und würden nur
// verwirren, wenn man sie roh in den Prompt schreibt. Nur echte Fancy-Color-Diamanten (braun,
// gelb, schwarz, ...) sind visuell relevant und werden hier erkannt; alles andere gilt als
// Standard-weißer/farbloser Diamant und wird im Prompt gar nicht erst erwähnt.
const FANCY_DIAMOND_COLOR_WORDS: Record<string, string> = {
  braun: "brauner Diamant",
  gelb: "gelber Diamant",
  schwarz: "schwarzer Diamant",
  pink: "pinker Diamant",
  grün: "grüner Diamant",
  orange: "oranger Diamant",
  blau: "blauer Diamant",
  rot: "roter Diamant",
  grau: "grauer Diamant",
  rosa: "rosa Diamant",
  champagner: "champagnerfarbener Diamant",
  cognac: "cognacfarbener Diamant",
};

function describeDiamondColor(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (FANCY_DIAMOND_COLOR_WORDS[normalized]) return FANCY_DIAMOND_COLOR_WORDS[normalized];
  if (normalized === "fancy") return "farbiger Fancy-Color-Diamant";
  return null;
}

// "Skaliere maßstabsgetreu" ist für ein Bildmodell zu abstrakt, wenn das freigestellte
// Referenzfoto (wie bei Produktfotos üblich bildfüllend) keinen echten Größenhinweis liefert -
// besonders bei sehr kleinen/dezenten Stücken (z.B. ein 11mm-Anhänger-Cluster) hat das Modell dann
// nichts, woran es sich orientieren kann, und macht das Schmuckstück tendenziell zu groß. Ein
// bekanntes Alltagsobjekt gibt einen konkreten visuellen Anker, den Bildmodelle aus ihren
// Trainingsdaten zuverlässig kennen. Bands grob an echten Objektgrößen orientiert (Stecknadelkopf
// ~2mm, Reiskorn ~6mm, Kichererbse ~8mm, 1-Cent-Münze ⌀16mm, Daumennagel ~15mm, 2-Euro-Münze
// ⌀26mm, Walnuss ~30mm) - Genauigkeit ist zweitrangig, es geht um eine intuitive Größenordnung.
function everydayObjectComparison(mm: number): string {
  if (mm < 4) return "ein Stecknadelkopf";
  if (mm < 7) return "ein Reiskorn";
  if (mm < 10) return "eine Kichererbse oder ein kleiner Hemdenknopf";
  if (mm < 15) return "eine Erbse oder eine 1-Cent-Münze (Durchmesser ca. 16mm)";
  if (mm < 20) return "ein Daumennagel oder eine Kirsche";
  if (mm < 28) return "eine 2-Euro-Münze (Durchmesser ca. 26mm)";
  if (mm < 40) return "eine Walnuss";
  return "eine Streichholzschachtel oder größer";
}

// Ermittelt die für den Größeneindruck maßgebliche sichtbare Motivgröße. Bewusst NUR
// Breite/Höhe (nicht Stärke/Länge/Ringgröße) - das sind die beiden Maße, die auch schon in
// "Maße:" oben auftauchen und die sichtbare Ausdehnung des Motivs beschreiben, nicht Dicke oder
// Ketten-/Umfangslänge. Durchmesser wird nur als Fallback genutzt und bei Armreifen/Armbändern
// bewusst ausgeschlossen, weil er dort die Handgelenks-Passform meint (immer groß) statt der
// sichtbaren Motivgröße - ein Alltagsobjekt-Vergleich wäre dort irreführend.
export function motifSizeMm(product: SourceProductRow): number | null {
  const faceDims = [product.breite, product.hoehe].filter(
    (v): v is number => v !== null && v > 0,
  );
  if (faceDims.length > 0) return Math.max(...faceDims);
  const isWristFit = product.hauptkategorie === "Armreifen" || product.hauptkategorie === "Armbänder";
  if (product.durchmesser && product.durchmesser > 0 && !isWristFit) return product.durchmesser;
  return null;
}

// Holt die echten Produktdaten (Material/Legierung, Diamant-/Farbstein-Details, Maße) und baut
// daraus einen Fakten-Block für den Bild-Prompt - der Bildgenerator soll Größe, Proportionen und
// Farben NICHT nur aus dem (ggf. unterschiedlich beleuchteten/komprimierten) Referenzfoto ableiten,
// sondern anhand der tatsächlichen Katalogdaten. Wichtig v.a. für die Metallfarbe: SYSTEM_INSTRUCTIONS
// schreibt bewusst ein warmes "Golden Hour"-Licht für alle Bilder vor, das Weißgold/Silber/Platin
// ohne diesen Hinweis leicht gelblich statt hell/kühl-silbrig einfärben würde. Wie
// stylePromptAddition bewusst NICHT Teil von defaultImageBasePrompt (dem editierbaren Prompt in der
// UI) - Produktdaten sind kein Wortlaut, den ein manueller Override versehentlich verlieren darf;
// falls ein Fakt falsch ist, ist die Korrektur die Produktdatenpflege, nicht der Prompt.
//
// mapping ist optional (Aufrufer ohne Kategorie-Zuordnung, z.B. eine zukünftige Vorschau ohne
// Produkt, können ihn weglassen) - wird er mitgegeben, ergänzt die Funktion zusätzlich zum
// mm-Alltagsobjekt-Vergleich einen "darf höchstens X% der Bildbreite einnehmen"-Wert
// (BodyPartMapping.estimatedFrameWidthMm). Grund: bei einem realen Test (Produkt 4R267R8, 11mm-
// Collier-Cluster) hat der reine mm/Alltagsobjekt-Vergleich allein gpt-image-1.5 NICHT sichtbar
// dazu gebracht, das Stück kleiner zu rendern - ein Flächenanteil im Bild selbst ist eine
// direktere Stellschraube als ein Wert, den das Modell erst über reale Anatomie in Bildmaßstab
// übersetzen müsste.
export function productFactsPromptAddition(product: SourceProductRow, mapping?: BodyPartMapping): string {
  const raw = product.rawJson ?? {};
  const facts: string[] = [];

  // hauptmaterial trägt die für die Bildfarbe entscheidende Angabe (z.B. "Weißgold"/"Gelbgold"/
  // "Platin"), legierung meist nur den Feingehalt ("18kt") - beide kombinieren, sonst geht die
  // Farbe unter, wenn legierung allein bevorzugt würde.
  const material = [product.hauptmaterial, product.legierung].filter(Boolean).join(", ");
  if (material) facts.push(`Material: ${material}`);

  const diamondSlotRows = diamondSlots(raw);
  const diamondCuts = uniqueNonEmpty(diamondSlotRows.map((s) => s.schliff));
  // Fancy-Farben aus den Einzelstein-Slots UND dem Übersichtsfeld sammeln - manche Produkte haben
  // nur eines der beiden gepflegt.
  const diamondColors = uniqueNonEmpty(
    [...diamondSlotRows.map((s) => s.farbe), product.diamantFarbe ?? undefined].map(
      (v) => describeDiamondColor(v) ?? undefined,
    ),
  );
  if (product.caratur || product.anzahlSteine || diamondCuts.length > 0 || diamondColors.length > 0) {
    const parts = [
      product.caratur ? `${product.caratur} Karat gesamt` : null,
      product.anzahlSteine ? `${product.anzahlSteine} Stein(e)` : null,
      diamondCuts.length > 0 ? `Schliffform ${diamondCuts.join("/")}` : null,
      diamondColors.length > 0 ? diamondColors.join("/") : null,
    ].filter((p): p is string => Boolean(p));
    if (parts.length > 0) facts.push(`Diamant(en): ${parts.join(", ")}`);
  }

  const coloredStones = coloredStoneSlots(raw)
    .map((s) => {
      const detail = [s.farbe, s.schliff, s.carat ? `${s.carat} Karat` : null]
        .filter((p): p is string => Boolean(p))
        .join(", ");
      return detail ? `${s.art} (${detail})` : s.art;
    })
    .filter(Boolean);
  if (coloredStones.length > 0) facts.push(`Farbstein(e): ${coloredStones.join("; ")}`);

  const dimensionParts = [
    product.ringgroesse ? `Ringgröße ${product.ringgroesse}` : null,
    product.hoehe ? `Höhe ${product.hoehe}mm` : null,
    product.breite ? `Breite ${product.breite}mm` : null,
    product.durchmesser ? `Durchmesser ${product.durchmesser}mm` : null,
    product.staerke ? `Stärke ${product.staerke}mm` : null,
    product.produktLaengeCm ? `Länge ${product.produktLaengeCm}cm` : null,
  ].filter((p): p is string => Boolean(p));
  if (dimensionParts.length > 0) facts.push(`Maße: ${dimensionParts.join(", ")}`);

  if (facts.length === 0) return "";

  const motifMm = motifSizeMm(product);
  const sizeAnchor = motifMm
    ? ` Zur Einordnung der realen Größe: Das sichtbare Motiv ist mit ca. ${motifMm}mm ungefähr so ` +
      `groß wie ${everydayObjectComparison(motifMm)} - orientiere dich an dieser Alltagsgröße für ` +
      `den Maßstab im Bild, NICHT an der (typischerweise bildfüllenden) Größe im freigestellten ` +
      `Referenzfoto.`
    : "";
  const maxWidthPercent =
    motifMm && mapping ? Math.max(1, Math.round((motifMm / mapping.estimatedFrameWidthMm) * 100)) : null;
  const frameWidthClause = maxWidthPercent
    ? ` KRITISCH als harte Obergrenze: Das gesamte Schmuckstück (alle Steine/Elemente zusammen) ` +
      `darf im fertigen Bild NICHT breiter als ca. ${maxWidthPercent}% der sichtbaren Bildbreite ` +
      `sein - miss das notfalls gedanklich gegen die Bildbreite ab, bevor du die finale Größe ` +
      `festlegst, statt dich an der Größe im freigestellten Referenzfoto zu orientieren.`
    : "";

  return (
    ` Echte Fakten zu diesem Schmuckstück aus den Produktdaten (gelten zusätzlich zum Referenzbild, ` +
    `nicht nur optisch aus ihm ableiten): ${facts.join(". ")}. Diese Fakten bestimmen Farbe und ` +
    `Proportionen im generierten Bild: Trotz der warmen Bildstimmung bleibt die echte Metallfarbe ` +
    `erkennbar - Weißgold/Silber/Platin bleibt hell und kühl-silbrig, wird NICHT gelblich ` +
    `dargestellt; Gelbgold bleibt warm-golden; Roségold bleibt zart roséfarben. Farbsteine zeigen ` +
    `exakt die angegebene Steinfarbe. Falls oben ein farbiger Diamant (z.B. brauner, gelber oder ` +
    `schwarzer Diamant) genannt ist, zeigt der Diamant exakt diese Farbe statt eines Standard-` +
    `weißen/farblosen Diamanten - ist dort KEINE Diamantfarbe genannt, bleibt der Diamant weiß/farblos. ` +
    `KRITISCH bei der Größe: Die oben genannten Maße (mm/cm) sind die tatsächliche Realgröße des ` +
    `Schmuckstücks - skaliere es im Bild exakt proportional zur echten Anatomie des Models ` +
    `entsprechend dieser Maße, NICHT nach freiem Ermessen oder zur besseren Bildwirkung. Ein sehr ` +
    `schmales/kleines Maß muss entsprechend zierlich und unauffällig neben Hand, Ohr, Hals oder ` +
    `Handgelenk wirken, ein großes Maß entsprechend prägnant und größer - vermeide sowohl ein ` +
    `unrealistisch übergroßes als auch ein zu kleines Schmuckstück.${sizeAnchor}${frameWidthClause}`
  );
}

export async function generateProductImageVariant(
  product: SourceProductRow,
  model: MarinellModel,
  poseVariant: PoseVariant,
  variantIndex: number,
): Promise<{ buffer: Buffer; prompt: string; chainMissing: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt (.env.local prüfen).");
  }

  const mapping = bodyPartMapping(product.hauptkategorie);
  if (!mapping) {
    throw new Error(
      `Keine Körperteil-Zuordnung für Kategorie "${product.hauptkategorie ?? "unbekannt"}" vorhanden.`,
    );
  }

  const refUrl = referenceImageUrl(product);
  if (!refUrl) {
    throw new Error("Kein Referenzfoto für dieses Produkt vorhanden (freistellerUrl/modelbildUrl/bildUrls leer).");
  }

  const referenceBuffer = await fetchImageBuffer(refUrl);
  const referenceFile = await toFile(referenceBuffer, "product-reference", { type: guessMimeType(refUrl) });

  const basePrompt = product.imagePromptOverride?.trim() || defaultImageBasePrompt(product);

  // Zweite Referenz: ein echtes Foto des zugewiesenen MARINELL-Models, ausschließlich für
  // Gesicht/Haartyp/Hautunterton/Foto-Stil. Das auf diesem Referenzfoto sichtbare Schmuckstück
  // gehört zu einer anderen Aufnahme dieses Models und darf in keiner Form übernommen werden - der
  // Mechanismus ist identisch zur früheren Stilreferenz, nur jetzt mit markeneigenen Fotos statt
  // einer fremden Marke. Ohne Override, da eine individuelle Prompt-Anpassung diese Anweisung nicht
  // versehentlich verlieren darf.
  const styleBuffer = await fetchImageBuffer(model.referenceImageUrl);
  const styleFile = await toFile(styleBuffer, "model-reference", {
    type: guessMimeType(model.referenceImageUrl),
  });
  const images = [referenceFile, styleFile];
  const stylePromptAddition =
    ` Dir werden ZWEI Bilder gegeben. Das ERSTE Bild zeigt das tatsächliche Schmuckstück, das ` +
    `unverändert dargestellt werden muss. Das ZWEITE Bild zeigt das Model ${model.name} auf einer ` +
    `anderen Aufnahme und dient AUSSCHLIESSLICH als Referenz für Gesicht, Haare, Hautunterton und ` +
    `fotografischen Stil (Pose, Kamerawinkel, Licht, Bildqualität). Übernimm aus dem zweiten Bild ` +
    `NIEMALS irgendeinen dort sichtbaren Schmuck (auch keine Ohrringe, Kette, Ringe oder Armbänder) ` +
    `- weder dessen Design noch die bloße Tatsache, dass auf diesem Foto Schmuck getragen wird. Das ` +
    `im generierten Bild sichtbare Schmuckstück muss zu 100% aus dem ERSTEN Bild stammen und ist ` +
    `das EINZIGE Schmuckstück im gesamten generierten Bild - das Model trägt sonst keinerlei ` +
    `Schmuck, unabhängig davon, was auf dem zweiten Referenzfoto zu sehen ist.`;

  const factsAddition = productFactsPromptAddition(product, mapping);

  const prompt =
    `${basePrompt}${factsAddition}${stylePromptAddition} Zeige ${poseVariant.promptDescriptor}. ` +
    `Hohe Auflösung, scharfer Fokus auf das Schmuckstück.`;

  // gpt-image-Modelle haben ein niedriges Per-Minute-Rate-Limit für Edit-Aufrufe; bei 3 parallelen
  // Varianten pro Produkt reicht das SDK-Default (2 Retries) oft nicht aus, um einen 429 mit
  // "retry after Ns" abzufedern - höheres maxRetries lässt den eingebauten Backoff das übernehmen.
  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const response = await client.images.edit({
    image: images,
    prompt,
    model: OPENAI_IMAGE_MODEL,
    size: mapping.size,
    quality: "high",
    input_fidelity: "high",
    output_format: "png",
    n: 1,
  });

  // Wie bei der Textgenerierung: Kosten werden verbucht, sobald die Antwort da ist, auch wenn
  // sie aus irgendeinem Grund kein Bild enthält - der Aufruf wurde in jedem Fall bezahlt.
  await recordApiUsage({
    provider: "openai",
    purpose: "image_generation",
    sourceProductId: product.id,
    variantIndex,
    model: OPENAI_IMAGE_MODEL,
    usage: response.usage,
    costUsd: estimateOpenAiImageCost(OPENAI_IMAGE_MODEL, response.usage),
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Bild-API hat kein Bild zurückgegeben.");
  }

  // Kein separater Kettenschritt in diesem Weg (Kette ist Teil desselben Generierungsschritts wie
  // der Rest des Bilds) - chainMissing ist hier also nie zutreffend, siehe Feld-Kommentar in schema.ts.
  return { buffer: Buffer.from(b64, "base64"), prompt, chainMissing: false };
}
