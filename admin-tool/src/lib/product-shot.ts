import "server-only";
import OpenAI, { toFile } from "openai";
import type { sourceProducts } from "@/db/schema";
import { fetchImageBuffer, guessMimeType } from "@/lib/image-generation";
import { estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";
import {
  PRODUCT_SHOT_COMPOSITIONS,
  type ProductShotBackground,
} from "@/lib/product-shot-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

const OPENAI_IMAGE_MODEL = "gpt-image-2";
const OUTPUT_SIZE = "1536x1536";

// Dynamischer sharp-Import aus demselben Grund wie in image-compositing.ts (Ladefehler soll nur
// den tatsächlichen Aufruf treffen, nicht jede Seite, die dieses Modul importiert).
async function loadSharp() {
  const mod = await import("sharp");
  return mod.default;
}

// Kandidaten für das Ausgangsfoto: reine Produktaufnahmen (Freisteller, weitere Produktbilder,
// eigene Uploads). Das Modelbild (Schmuck am Körper) ist bewusst nur Notfall-Fallback, weil die
// Bild-API sonst Teile der Person mit ins Produktbild übernehmen kann.
function candidateUrls(product: SourceProductRow): string[] {
  const urls = [
    product.freistellerUrl,
    ...(product.bildUrls ?? []),
    ...(product.customImages ?? []).map((img) => img.url),
  ].filter((u): u is string => Boolean(u));
  return [...new Set(urls)];
}

export async function pickBestSourceImage(
  product: SourceProductRow,
): Promise<{ url: string; buffer: Buffer; pixels: number }> {
  const sharp = await loadSharp();
  const candidates = candidateUrls(product);
  if (candidates.length === 0 && product.modelbildUrl) candidates.push(product.modelbildUrl);
  if (candidates.length === 0) {
    throw new Error("Kein Produktfoto vorhanden (freistellerUrl/bildUrls/modelbildUrl leer).");
  }

  // Einzelne nicht ladbare Bilder dürfen die Auswahl nicht kippen - nur wenn gar keins lädt, Fehler.
  const loaded = (
    await Promise.all(
      candidates.map(async (url) => {
        try {
          const buffer = await fetchImageBuffer(url);
          const meta = await sharp(buffer).metadata();
          return { url, buffer, pixels: (meta.width ?? 0) * (meta.height ?? 0) };
        } catch {
          return null;
        }
      }),
    )
  ).filter((c): c is { url: string; buffer: Buffer; pixels: number } => c !== null && c.pixels > 0);

  if (loaded.length === 0) throw new Error("Keines der vorhandenen Produktfotos konnte geladen werden.");
  return loaded.reduce((best, c) => (c.pixels > best.pixels ? c : best));
}

function buildPrompt(background: ProductShotBackground, compositionIndex: number): string {
  const composition = PRODUCT_SHOT_COMPOSITIONS[compositionIndex] ?? PRODUCT_SHOT_COMPOSITIONS[0];
  return (
    `Kontext: professionelle E-Commerce-Produktfotografie für eine Fine-Jewellery-Marke. Das Bild ` +
    `zeigt das Schmuckstück vom Referenzfoto, neu in Szene gesetzt als hochwertiges Stillleben. ` +
    `Das Schmuckstück muss EXAKT dem Referenzfoto entsprechen: gleiche Form, gleiche Proportionen, ` +
    `gleiche Anzahl und Anordnung aller Steine und Elemente, gleiche Metallfarbe (Weißgold/Silber ` +
    `bleibt hell und kühl, Gelbgold warm, Roségold zart rosé), gleiche Steinfarben - nichts ` +
    `hinzufügen, weglassen oder umgestalten. Falls das Referenzfoto eine Person oder Hand zeigt, ` +
    `übernimm NUR das Schmuckstück, keine Person, keine Haut, keine Kleidung. ` +
    `Szene: Das Schmuckstück liegt ruhig und natürlich auf ${background.promptDescriptor}. ` +
    `Es ist das einzige Objekt im Bild, keine weiteren Schmuckstücke, kein Text, keine Logos, ` +
    `keine Verpackung. Perspektive: ${composition.promptDescriptor}. ` +
    `Realistische Kontaktschatten und feine Reflexionen, wo das Metall den Untergrund berührt; ` +
    `Metall und Steine brillant und detailreich, scharfer Fokus auf das Schmuckstück, hohe ` +
    `Auflösung, zurückhaltende, warme, zeitlose Editorial-Bildsprache.`
  );
}

export async function generateProductShotVariant(
  product: SourceProductRow,
  background: ProductShotBackground,
  variantIndex: number,
): Promise<{ buffer: Buffer; prompt: string; chainMissing: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ist nicht gesetzt (.env.local prüfen).");

  const source = await pickBestSourceImage(product);
  const sourceFile = await toFile(source.buffer, "product-source", { type: guessMimeType(source.url) });
  const prompt = buildPrompt(background, variantIndex);

  const client = new OpenAI({ apiKey, maxRetries: 6 });
  const response = await client.images.edit({
    image: [sourceFile],
    prompt,
    model: OPENAI_IMAGE_MODEL,
    size: OUTPUT_SIZE,
    quality: "high",
    output_format: "png",
    n: 1,
  });

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
  if (!b64) throw new Error("Bild-API hat kein Bild zurückgegeben.");

  return { buffer: Buffer.from(b64, "base64"), prompt, chainMissing: false };
}
