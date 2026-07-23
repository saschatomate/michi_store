import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import { bodyPartMapping, type HandPreset } from "@/lib/image-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

// Editorial-Luxus-Schmuckfotografie im Stil großer Schmuckhäuser wie Tiffany & Co.: großzügiger,
// eleganter Bildausschnitt, der spürbar mehr vom Model zeigt als ein reines Produkt-Makrofoto -
// keine isolierte Hand/Ohr/Hals-Nahaufnahme vor leerem Hintergrund. Geringe Schärfentiefe, weicher
// neutraler Studio-Hintergrund, kein Model-Casting-Foto.
const SYSTEM_INSTRUCTIONS =
  "Editorial-Luxus-Schmuckfotografie im Stil großer Schmuckhäuser wie Tiffany & Co. Großzügiger, " +
  "eleganter Bildausschnitt, der deutlich mehr vom Model zeigt als eine isolierte Nahaufnahme nur " +
  "des Schmuckstücks - je nach Schmuckart z.B. Teile von Kinn/Mund, Hals, Schulter, Dekolleté oder " +
  "Oberkörper mit im Bild, dazu passende schlichte Kleidung, exakt wie in den Beispielbildern " +
  "großer Schmuckhäuser wie Tiffany & Co. Das Schmuckstück bleibt scharf im Fokus, alles andere " +
  "(Haare, Hintergrund, entferntere Hautpartien) durch geringe Schärfentiefe (Bokeh) leicht " +
  "unscharf. Weicher, neutraler, warmgrauer Studio-Hintergrund ohne sichtbare Struktur oder " +
  "Requisiten. Weiches, diffuses Studiolicht mit sanften Schatten, keine harten Reflexe. Kein " +
  "vollständiges Gesicht im Bild (Augen bleiben außerhalb des Bildausschnitts), ruhige, " +
  "unaufdringliche Ausstrahlung. Minimale, neutrale Kleidung (z.B. schlichtes weißes Hemd oder " +
  "schwarzer Rollkragenpullover), die nicht vom Schmuckstück ablenkt. " +
  "Natürliche, warme Hauttöne, ruhige editorial Farbgebung mit sanftem Kontrast. Kein Text, kein " +
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

// Der Basis-Prompt (ohne Hautton-/Handform-Zusatz, der pro Variante wechselt) - wird sowohl für die
// echte Generierung als auch zum Vorausfüllen der Prompt-Bearbeiten-Ansicht in der UI verwendet.
export function defaultImageBasePrompt(product: SourceProductRow): string {
  const mapping = bodyPartMapping(product.hauptkategorie);
  if (!mapping) return "";
  return (
    `${SYSTEM_INSTRUCTIONS} Setze DIESES Schmuckstück (aus dem Referenzbild) unverändert auf ` +
    `${mapping.bodyPart}. ${mapping.compositionHint}.`
  );
}

export async function generateProductImageVariant(
  product: SourceProductRow,
  preset: HandPreset,
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

  // Optionale zweite Referenz (nur Foto-Stil: Pose, Licht, Bildausschnitt, Model-Qualität) - das
  // dort abgebildete Schmuckstück gehört einer anderen Marke und darf in keiner Form übernommen
  // werden. Nur unbrandete, generische Auswahl verwendet (siehe styleReferenceUrl-Kommentar in
  // image-facts.ts). Ohne Override, da eine individuelle Prompt-Anpassung diese Anweisung nicht
  // versehentlich verlieren darf.
  const images = [referenceFile];
  let stylePromptAddition = "";
  if (mapping.styleReferenceUrl) {
    const styleBuffer = await fetchImageBuffer(mapping.styleReferenceUrl);
    const styleFile = await toFile(styleBuffer, "style-reference", {
      type: guessMimeType(mapping.styleReferenceUrl),
    });
    images.push(styleFile);
    stylePromptAddition =
      " Dir werden ZWEI Bilder gegeben. Das ERSTE Bild zeigt das tatsächliche Schmuckstück, das " +
      "unverändert dargestellt werden muss. Das ZWEITE Bild zeigt eine andere Schmuckmarke auf " +
      "einem Model und dient AUSSCHLIESSLICH als fotografische Stilreferenz: Pose, Kamerawinkel, " +
      "Bildausschnitt, Beleuchtung, Hautwiedergabe und allgemeine Bildqualität. Übernimm aus dem " +
      "zweiten Bild NIEMALS das dort abgebildete Schmuckstück, dessen Design, Form, Logo, Gravur " +
      "oder Markenzeichen - das im generierten Bild sichtbare Schmuckstück muss zu 100% aus dem " +
      "ERSTEN Bild stammen.";
  }

  const prompt =
    `${basePrompt}${stylePromptAddition} Zeige ${preset.promptDescriptor}. Hohe Auflösung, scharfer ` +
    `Fokus auf das Schmuckstück.`;

  // gpt-image-Modelle haben ein niedriges Per-Minute-Rate-Limit für Edit-Aufrufe; bei 3 parallelen
  // Varianten pro Produkt reicht das SDK-Default (2 Retries) oft nicht aus, um einen 429 mit
  // "retry after Ns" abzufedern - höheres maxRetries lässt den eingebauten Backoff das übernehmen.
  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const response = await client.images.edit({
    image: images,
    prompt,
    model: "gpt-image-1.5",
    size: mapping.size,
    quality: "high",
    input_fidelity: "high",
    output_format: "png",
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Bild-API hat kein Bild zurückgegeben.");
  }

  return { buffer: Buffer.from(b64, "base64"), prompt };
}
