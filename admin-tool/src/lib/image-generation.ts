import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import { bodyPartMapping, assignModel, MARINELL_MODELS, type MarinellModel, type PoseVariant } from "@/lib/image-facts";
import { estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";

type SourceProductRow = typeof sourceProducts.$inferSelect;

const OPENAI_IMAGE_MODEL = "gpt-image-1.5";

// MARINELL Editorial-Fotografie (aus "01 MARINELL Brand DNA.docx"): leise, warme, zeitlose
// Bildsprache statt lauter Statussymbolik. Großzügiger, eleganter Bildausschnitt, der spürbar mehr
// vom Model zeigt als ein reines Produkt-Makrofoto - keine isolierte Hand/Ohr/Hals-Nahaufnahme vor
// leerem Hintergrund.
const SYSTEM_INSTRUCTIONS =
  "MARINELL Editorial-Luxus-Schmuckfotografie: 'Luxury, lived discreetly' - die Bildsprache ist " +
  "leise, ruhig, nie laut oder aufdringlich. Sie transportiert Ruhe, Eleganz, Wärme, Vertrauen und " +
  "Zeitlosigkeit - NICHT Status, Reichtum oder Dekadenz. Großzügiger, eleganter Bildausschnitt, " +
  "der deutlich mehr vom Model zeigt als eine isolierte Nahaufnahme nur des Schmuckstücks - je " +
  "nach Schmuckart z.B. Teile von Kinn/Mund, Hals, Schulter, Dekolleté oder Oberkörper mit im " +
  "Bild. Das Schmuckstück bleibt scharf im Fokus, alles andere (Haare, Hintergrund, entferntere " +
  "Hautpartien) durch geringe Schärfentiefe (Bokeh) leicht unscharf. Hintergrund: champagnerfarbener " +
  "Seiden-/Satinvorhang mit weichen Falten, oder alternativ ein warmer, heller Sandton-Studiohintergrund " +
  "ohne sichtbare Struktur oder Requisiten - Farbwelt durchgehend Ivory, Champagne, Warm Sand, " +
  "Cashmere, Black, Warm Gold, Soft Taupe. Licht: warmes 'Golden Hour'/Champagnerlicht - großes, " +
  "weiches Beauty-Light von links oben, warme Farbtemperatur, feines Kantenlicht, sanfte Schatten, " +
  "keine harten Reflexe. Kein vollständiges Gesicht im Bild (Augen bleiben außerhalb des " +
  "Bildausschnitts), ruhige, unaufdringliche Ausstrahlung. Kleidung: schwarzes Seiden-Slip-Kleid, " +
  "champagnerfarbenes Satinkleid oder cremefarbener Kaschmir/Blazer - schlicht, ohne Muster oder " +
  "Logos, die nicht vom Schmuckstück ablenken. Natürliche Retusche: echte Hautstruktur mit " +
  "sichtbaren Poren und ggf. dezenten Sommersprossen bleibt erhalten, keine Plastikhaut, keine " +
  "übertriebene Beauty-Retusche. Ruhige editorial Farbgebung mit sanftem Kontrast. Kein Text, kein " +
  "Logo, kein Wasserzeichen im Bild. Kein weiterer Schmuck außer dem abgebildeten Referenzstück " +
  "sichtbar. Verändere das Schmuckstück selbst NICHT - Form, Fassung, Steinanzahl und Material " +
  "müssen exakt wie im Referenzbild bleiben. Spiegle oder drehe das Schmuckstück NICHT - " +
  "Vorderseite, Rückseite sowie Innen- und Außenseite müssen exakt wie im Referenzbild ausgerichtet " +
  "bleiben. Generiere nur die Körperpartie und die Umgebung drumherum. " +
  "KRITISCH bei Händen: Die Hand muss anatomisch absolut korrekt sein - genau fünf Finger inklusive " +
  "sichtbarem Daumen, jeder Finger einzeln und klar voneinander getrennt, natürliche Proportionen " +
  "und Gelenke. Vermeide stark gekrümmte, verschränkte oder zur Faust geballte Fingerhaltungen, bei " +
  "denen Finger übereinander- oder ineinanderliegen - das führt zu Fehlern wie verschmolzenen " +
  "Fingern oder einem fehlenden Daumen. Bei Ringen: Der Ring sitzt vollständig auf GENAU EINEM " +
  "Finger und umschließt nur diesen einen Finger - er darf niemals zwei Finger überbrücken, " +
  "verbinden oder wie ein Steg zwischen zwei Fingern wirken.";

function referenceImageUrl(product: SourceProductRow): string | null {
  if (product.freistellerUrl) return product.freistellerUrl;
  if (product.modelbildUrl) return product.modelbildUrl;
  if (product.bildUrls && product.bildUrls.length > 0) return product.bildUrls[0];
  return null;
}

function guessMimeType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
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
    `${SYSTEM_INSTRUCTIONS} Das Model in diesem Bild: ${model.physicalDescription} Setze DIESES ` +
    `Schmuckstück (aus dem Referenzbild) unverändert auf ${mapping.bodyPart}. ${mapping.compositionHint}.`
  );
}

export async function generateProductImageVariant(
  product: SourceProductRow,
  model: MarinellModel,
  poseVariant: PoseVariant,
  variantIndex: number,
): Promise<{ buffer: Buffer; prompt: string }> {
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
    `NIEMALS das dort abgebildete Schmuckstück, dessen Design, Form oder Fassung - das im ` +
    `generierten Bild sichtbare Schmuckstück muss zu 100% aus dem ERSTEN Bild stammen.`;

  const prompt =
    `${basePrompt}${stylePromptAddition} Zeige ${poseVariant.promptDescriptor}. Hohe Auflösung, ` +
    `scharfer Fokus auf das Schmuckstück.`;

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

  return { buffer: Buffer.from(b64, "base64"), prompt };
}
