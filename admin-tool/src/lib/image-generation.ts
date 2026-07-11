import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import { bodyPartMapping, type HandPreset } from "@/lib/image-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

const SYSTEM_INSTRUCTIONS =
  "Fotorealistisches Schmuck-Produktfoto für eine hochwertige Schmuckmarke. Studio-Beleuchtung, " +
  "neutraler, dezenter Hintergrund. Kein Text, kein Logo, kein Wasserzeichen im Bild. Kein weiterer " +
  "Schmuck außer dem abgebildeten Referenzstück sichtbar. Verändere das Schmuckstück selbst NICHT - " +
  "Form, Fassung, Steinanzahl und Material müssen exakt wie im Referenzbild bleiben. Generiere nur " +
  "die Körperpartie und die Umgebung drumherum.";

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
  const referenceFile = await toFile(referenceBuffer, "reference", { type: guessMimeType(refUrl) });

  const prompt =
    `${SYSTEM_INSTRUCTIONS} Setze DIESES Schmuckstück (aus dem Referenzbild) unverändert auf ` +
    `${mapping.bodyPart}. ${mapping.compositionHint}. Zeige ${preset.promptDescriptor}. Hohe Auflösung, ` +
    `scharfer Fokus auf das Schmuckstück.`;

  // gpt-image-Modelle haben ein niedriges Per-Minute-Rate-Limit für Edit-Aufrufe; bei 3 parallelen
  // Varianten pro Produkt reicht das SDK-Default (2 Retries) oft nicht aus, um einen 429 mit
  // "retry after Ns" abzufedern - höheres maxRetries lässt den eingebauten Backoff das übernehmen.
  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const response = await client.images.edit({
    image: referenceFile,
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
