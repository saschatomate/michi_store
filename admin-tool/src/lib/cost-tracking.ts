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

// Kein Bild-Model rechnet pro Bild ab, sondern über Text-/Bild-Input- und Bild-Output-Tokens (wie
// bei den Chat-Modellen) - die exakten Token-Zahlen kommen aus response.usage der Images-API. Alle
// von OpenAI aktuell angebotenen Bild-Modelle sind hier hinterlegt (auch die nicht selbst
// aufgerufenen), damit MOST_EXPENSIVE_IMAGE_PRICING unten korrekt das teuerste ermitteln kann.
const OPENAI_IMAGE_PRICING_PER_MTOK: Record<string, { text: number; image: number; output: number }> = {
  "gpt-image-1": { text: 5, image: 10, output: 40 },
  "gpt-image-1.5": { text: 5, image: 8, output: 32 },
  "gpt-image-1-mini": { text: 2, image: 2.5, output: 8 },
  "gpt-image-2": { text: 5, image: 8, output: 30 },
  "chatgpt-image-latest": { text: 5, image: 8, output: 32 },
};

// Kostenanzeige (Budget-Widget, Kosten-Badge pro Bild) rechnet bewusst konservativ: unabhängig
// davon, welches Model tatsächlich aufgerufen wurde (aktuell gpt-image-1.5, s. image-generation.ts
// OPENAI_IMAGE_MODEL), wird immer mit dem Tarif des teuersten hinterlegten Bild-Models gerechnet -
// Stand jetzt gpt-image-1 ($40 statt $32 pro 1M Output-Tokens). Das ist eine bewusste
// Sicherheitsmarge/Puffer für die interne Budget-Anzeige (die ohnehin nur eine manuell gepflegte
// Obergrenze ist, kein echter OpenAI-Kontostand, s. getBudgetSummary), nicht die tatsächliche
// OpenAI-Rechnung. Wird aus der Tabelle oben ermittelt (höchster Output-Preis) statt hart codiert,
// damit ein künftig noch teureres Model die Marge automatisch mit anhebt. Der im Ledger geloggte
// "model"-Wert bleibt trotzdem das tatsächlich aufgerufene Model (Audit-Trail) - nur der Preis, mit
// dem gerechnet wird, ist konservativ.
const MOST_EXPENSIVE_IMAGE_PRICING = Object.values(OPENAI_IMAGE_PRICING_PER_MTOK).reduce((priciest, candidate) =>
  candidate.output > priciest.output ? candidate : priciest,
);

// Zusätzlicher Aufschlag oben auf den bereits teuersten Tarif - explizit angefordert, weil die
// reine "teuerstes Model"-Marge dem Nutzer noch nicht genug Puffer war. 1.5 = 50% mehr als
// MOST_EXPENSIVE_IMAGE_PRICING. Wirkt multiplikativ auf den kompletten Bild-Kostenwert (Budget-
// Widget, Kosten-Badge pro Bild) - betrifft nur die interne Anzeige, nicht die echte OpenAI-Rechnung.
const IMAGE_COST_SAFETY_MARGIN_MULTIPLIER = 1.5;

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
  if (!OPENAI_IMAGE_PRICING_PER_MTOK[model]) {
    console.warn(
      `[cost-tracking] Bild-Model "${model}" fehlt in OPENAI_IMAGE_PRICING_PER_MTOK - rechne trotzdem ` +
        `konservativ mit dem teuersten hinterlegten Tarif weiter (siehe MOST_EXPENSIVE_IMAGE_PRICING).`,
    );
  }
  const pricing = MOST_EXPENSIVE_IMAGE_PRICING;
  const textTokens = usage.input_tokens_details?.text_tokens ?? 0;
  const imageTokens = usage.input_tokens_details?.image_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const baseCost =
    (textTokens / 1_000_000) * pricing.text +
    (imageTokens / 1_000_000) * pricing.image +
    (outputTokens / 1_000_000) * pricing.output;
  return baseCost * IMAGE_COST_SAFETY_MARGIN_MULTIPLIER;
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
