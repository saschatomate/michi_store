import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { apiUsageEvents, type ApiUsageProvider, type ApiUsagePurpose } from "@/db/schema";

// Preistabellen (Stand 2026-08, siehe platform.claude.com/docs/pricing bzw.
// developers.openai.com/api/docs/pricing). Weder Anthropic noch OpenAI bieten für normale
// API-Keys einen Guthaben-/Kontostand-Endpoint - die Budget-Anzeige im Admin (siehe
// getBudgetSummary) beruht deshalb komplett darauf, dass hier JEDER Aufruf korrekt verbucht wird.
// Bei einer Preisänderung nur diese Tabellen anpassen; die Berechnung selbst nutzt immer die
// tatsächlich von der jeweiligen API zurückgegebene Token-Nutzung, nie eine Schätzung.
const CLAUDE_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-5": { input: 5, output: 25 },
};

// gpt-image-1.5 rechnet nicht pro Bild ab, sondern über Text-/Bild-Input- und Bild-Output-Tokens
// (wie bei den Chat-Modellen) - die exakten Zahlen kommen aus response.usage der Images-API.
const OPENAI_IMAGE_PRICING_PER_MTOK: Record<string, { text: number; image: number; output: number }> = {
  "gpt-image-1.5": { text: 5, image: 8, output: 32 },
  "gpt-image-1": { text: 5, image: 10, output: 40 },
};

type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
};

export function estimateClaudeTextCost(model: string, usage: ClaudeUsage): number {
  const pricing = CLAUDE_PRICING_PER_MTOK[model];
  if (!pricing) {
    console.warn(`[cost-tracking] Keine Preistabelle für Claude-Model "${model}" - Kosten werden als 0 gebucht.`);
    return 0;
  }
  return (usage.input_tokens / 1_000_000) * pricing.input + (usage.output_tokens / 1_000_000) * pricing.output;
}

type OpenAiImageUsage = {
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

export function estimateOpenAiImageCost(model: string, usage: OpenAiImageUsage | undefined | null): number {
  if (!usage) return 0;
  const pricing = OPENAI_IMAGE_PRICING_PER_MTOK[model];
  if (!pricing) {
    console.warn(`[cost-tracking] Keine Preistabelle für Bild-Model "${model}" - Kosten werden als 0 gebucht.`);
    return 0;
  }
  const textTokens = usage.input_tokens_details?.text_tokens ?? 0;
  const imageTokens = usage.input_tokens_details?.image_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return (
    (textTokens / 1_000_000) * pricing.text +
    (imageTokens / 1_000_000) * pricing.image +
    (outputTokens / 1_000_000) * pricing.output
  );
}

// Schreibt einen Ledger-Eintrag. Darf eine ansonsten erfolgreiche Generierung nie zum Scheitern
// bringen - ein Logging-Fehler wird deshalb nur geloggt, nicht geworfen.
export async function recordApiUsage(entry: {
  provider: ApiUsageProvider;
  purpose: ApiUsagePurpose;
  sourceProductId?: number | null;
  variantIndex?: number | null;
  model: string;
  usage: unknown;
  costUsd: number;
}): Promise<void> {
  try {
    await db.insert(apiUsageEvents).values({
      provider: entry.provider,
      purpose: entry.purpose,
      sourceProductId: entry.sourceProductId ?? null,
      variantIndex: entry.variantIndex ?? null,
      model: entry.model,
      usage: (entry.usage ?? null) as Record<string, unknown> | null,
      costUsd: entry.costUsd,
    });
  } catch (err) {
    console.error("[cost-tracking] Konnte API-Nutzung nicht loggen:", err);
  }
}

export type BudgetSummary = {
  totalBudgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
};

// Budget ist eine einzige, manuell gepflegte Obergrenze (siehe budget-actions.ts) - "verbraucht"
// ist die Summe aller je gebuchten Kosten (all-time, kein monatlicher Reset).
export async function getBudgetSummary(): Promise<BudgetSummary> {
  const [settingsRow, [spentRow]] = await Promise.all([
    db.query.budgetSettings.findFirst(),
    db.select({ spentUsd: sql<number>`coalesce(sum(${apiUsageEvents.costUsd}), 0)` }).from(apiUsageEvents),
  ]);

  const totalBudgetUsd = settingsRow?.totalBudgetUsd ?? 0;
  const spentUsd = Number(spentRow?.spentUsd ?? 0);
  return {
    totalBudgetUsd,
    spentUsd,
    remainingUsd: totalBudgetUsd - spentUsd,
  };
}

export type ProductGenerationCosts = {
  contentGenerationCostUsd: number | null;
  imageCostByVariant: Map<number, number>;
};

// Für die Produktdetailseite: Kosten des zuletzt tatsächlich abgeschickten Aufrufs pro
// Textgenerierung und pro Bild-Varianten-Slot (nicht pro DB-Zeile in productGeneratedImages, denn
// eine abgelehnte/neu generierte Variante behält ihre alten Kosten nicht in dieser Tabelle - der
// Ledger in apiUsageEvents ist die verlässliche Quelle).
export async function getLatestCostsForProduct(sourceProductId: number): Promise<ProductGenerationCosts> {
  const events = await db.query.apiUsageEvents.findMany({
    where: eq(apiUsageEvents.sourceProductId, sourceProductId),
    orderBy: desc(apiUsageEvents.createdAt),
  });

  const contentEvent = events.find((e) => e.purpose === "text_generation");
  const imageCostByVariant = new Map<number, number>();
  for (const event of events) {
    if (event.purpose !== "image_generation" || event.variantIndex === null) continue;
    if (!imageCostByVariant.has(event.variantIndex)) {
      imageCostByVariant.set(event.variantIndex, event.costUsd);
    }
  }

  return {
    contentGenerationCostUsd: contentEvent?.costUsd ?? null,
    imageCostByVariant,
  };
}
