import "server-only";
import { and, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";
import { db } from "@/db/client";
import { imageBackgrounds, productGeneratedImages, type sourceProducts } from "@/db/schema";
import { fetchImageBuffer, guessMimeType } from "@/lib/image-generation";
import { estimateClaudeTextCost, estimateOpenAiImageCost, recordApiUsage } from "@/lib/cost-tracking";
import { signGeneratedImage } from "@/lib/c2pa-sign";
import { uploadGeneratedImage, deleteGeneratedImage } from "@/lib/image-storage";

type SourceProductRow = typeof sourceProducts.$inferSelect;
type BackgroundRow = typeof imageBackgrounds.$inferSelect;

const OPENAI_IMAGE_MODEL = "gpt-image-2";
const CLAUDE_MODEL = "claude-opus-4-8";
const OUTPUT_SIZE = "1536x1536";
export const ENHANCED_SHOT_LABEL = "KI-Produktbild (DG-Foto)";

// Nur das erste DG-Produktbild ist Ausgangsmaterial (Entscheidung 2026-11-13).
function firstDgImageUrl(product: SourceProductRow): string | null {
  return product.bildUrls?.[0] ?? product.freistellerUrl ?? product.modelbildUrl ?? null;
}

// Lässt Claude den passendsten Hintergrund der Bibliothek wählen (Produktfoto + Hintergrundfotos +
// Beschreibungen/Kategorien). Bei nur einem Hintergrund entfällt der Aufruf.
export async function pickBackgroundForProduct(
  product: SourceProductRow,
  backgrounds: BackgroundRow[],
): Promise<BackgroundRow> {
  if (backgrounds.length === 0) throw new Error("Keine Hintergründe angelegt (Seite „Hintergründe“).");
  if (backgrounds.length === 1) return backgrounds[0];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt (.env.local prüfen).");
  const productUrl = firstDgImageUrl(product);
  if (!productUrl) throw new Error("Kein DG-Produktbild vorhanden.");

  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: "Produktfoto:" },
    { type: "image", source: { type: "url", url: productUrl } },
    {
      type: "text",
      text:
        `Produkt: ${product.kurzBezeichnungDe ?? product.modellErweitert}, Kategorie ${product.hauptkategorie ?? "?"}, ` +
        `Material ${product.hauptmaterial ?? "?"}. Wähle den Hintergrund, auf dem dieses Schmuckstück am hochwertigsten ` +
        `wirkt (Kontrast zur Metallfarbe, Stimmung, Kategorie-Hinweise). Verfügbare Hintergründe:`,
    },
  ];
  for (const bg of backgrounds) {
    content.push(
      { type: "text", text: `ID ${bg.id} – ${bg.name}. ${bg.description ?? ""} ${bg.categories.length ? `Bevorzugt für: ${bg.categories.join(", ")}.` : ""}` },
      { type: "image", source: { type: "url", url: bg.imageUrl } },
    );
  }
  content.push({ type: "text", text: "Antworte als JSON mit der ID des gewählten Hintergrunds." });

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { backgroundId: { type: "integer" } },
          required: ["backgroundId"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content }],
  });
  await recordApiUsage({
    provider: "anthropic",
    purpose: "background_selection",
    sourceProductId: product.id,
    model: CLAUDE_MODEL,
    usage: response.usage,
    costUsd: estimateClaudeTextCost(CLAUDE_MODEL, response.usage),
  });

  const block = response.content.find((b) => b.type === "text");
  const id = block && block.type === "text" ? (JSON.parse(block.text) as { backgroundId: number }).backgroundId : null;
  return backgrounds.find((b) => b.id === id) ?? backgrounds[0];
}

// Prompt von Sascha (2026-11-15). Der Hintergrund ist nicht mehr fest "dunkler Marmor", sondern der
// jeweils gewählte aus der Bibliothek (Bild 2).
function buildPrompt(): string {
  return (
    `Bild 1 ist das Schmuckfoto, Bild 2 ist das Hintergrundbild. ` +
    `Verwende das Hintergrundbild und das Schmuckfoto, um eine hochwertige, fotorealistische Produktaufnahme zu erstellen. ` +
    `Platziere die Schmuckstücke elegant auf dem Hintergrund aus Bild 2 und bewahre ihre ursprüngliche Form, ` +
    `Proportionen, Farbe, Gravuren und sämtliche Designdetails exakt – ohne Verzerrungen oder hinzugefügte Elemente. ` +
    `Entferne Staub, Fingerabdrücke und oberflächliche Kratzer behutsam, ohne Materialstruktur oder Details zu verändern. ` +
    `Stimme Perspektive, Größe und Ausrichtung natürlich auf den Hintergrund ab. ` +
    `Setze weiches Studiolicht, realistische Kontaktschatten und dezente Reflexionen ein, damit der Schmuck glaubwürdig ` +
    `auf dem Hintergrund aus Bild 2 liegt. Edelsteine und Metall sollen klar, natürlich und hochwertig wirken, ohne übertriebene ` +
    `Glanz- oder Funkel-Effekte. Der Schmuck steht im Mittelpunkt und ist gestochen scharf. ` +
    `Keine zusätzlichen Schmuckstücke, keine Dekoration, keine Schrift und keine Logos.`
  );
}

// Erzeugt das KI-Produktbild für Slot 1 (variantIndex 0): erstes DG-Foto + Hintergrund. Landet als
// "pending_review", weil die KI das Schmuckstück verfälschen könnte - Freigabe bleibt manuell.
export async function generateEnhancedShot(
  product: SourceProductRow,
  backgroundId: number | null,
): Promise<{ backgroundName: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ist nicht gesetzt (.env.local prüfen).");
  const sourceUrl = firstDgImageUrl(product);
  if (!sourceUrl) throw new Error("Kein DG-Produktbild vorhanden.");

  const all = await db.select().from(imageBackgrounds);
  const background =
    backgroundId !== null
      ? all.find((b) => b.id === backgroundId)
      : await pickBackgroundForProduct(product, all);
  if (!background) throw new Error("Hintergrund nicht gefunden.");

  const existing = await db.query.productGeneratedImages.findFirst({
    where: and(eq(productGeneratedImages.sourceProductId, product.id), eq(productGeneratedImages.variantIndex, 0)),
  });
  if (existing?.status === "approved") return { backgroundName: background.name };

  const [src, bg] = await Promise.all([fetchImageBuffer(sourceUrl), fetchImageBuffer(background.imageUrl)]);
  const prompt = buildPrompt();
  const label = `${ENHANCED_SHOT_LABEL} – ${background.name}`;

  try {
    const client = new OpenAI({ apiKey, maxRetries: 6 });
    const response = await client.images.edit({
      image: [
        await toFile(src, "product", { type: guessMimeType(sourceUrl) }),
        await toFile(bg, "background", { type: guessMimeType(background.imageUrl) }),
      ],
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
      variantIndex: 0,
      model: OPENAI_IMAGE_MODEL,
      usage: response.usage,
      costUsd: estimateOpenAiImageCost(OPENAI_IMAGE_MODEL, response.usage),
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("Bild-API hat kein Bild zurückgegeben.");

    const signed = await signGeneratedImage(Buffer.from(b64, "base64"), prompt);
    const path = `generated/${product.id}/0-${Date.now()}.png`;
    const { url } = await uploadGeneratedImage(signed, path);
    if (existing?.storagePath) await deleteGeneratedImage(existing.storagePath).catch(() => {});

    const values = {
      handPreset: label,
      imageUrl: url,
      storagePath: path,
      status: "pending_review" as const,
      approvedAt: null,
      generatedAt: new Date(),
      generationError: null,
      chainMissing: false,
      isUpload: false,
    };
    if (existing) await db.update(productGeneratedImages).set(values).where(eq(productGeneratedImages.id, existing.id));
    else await db.insert(productGeneratedImages).values({ sourceProductId: product.id, variantIndex: 0, ...values });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[enhanced-shot] ${product.modellErweitert}:`, err);
    if (existing) await db.update(productGeneratedImages).set({ generationError: message }).where(eq(productGeneratedImages.id, existing.id));
    else await db.insert(productGeneratedImages).values({ sourceProductId: product.id, variantIndex: 0, handPreset: label, status: "pending_review", generationError: message });
    throw err;
  }
  return { backgroundName: background.name };
}
