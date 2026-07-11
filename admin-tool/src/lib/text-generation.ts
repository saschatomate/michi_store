import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { sourceProducts } from "@/db/schema";
import { diamondSlots, coloredStoneSlots } from "@/lib/product-facts";

type SourceProductRow = typeof sourceProducts.$inferSelect;

export type GeneratedContent = {
  productName: string;
  shortDescDe: string;
  longDescDe: string;
  shortDescEn: string;
  longDescEn: string;
  seoTitle: string;
  seoDescription: string;
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    productName: { type: "string", description: "Markenstil-Produktname, kein Modellcode" },
    shortDescDe: { type: "string" },
    longDescDe: { type: "string" },
    shortDescEn: { type: "string" },
    longDescEn: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
  },
  required: [
    "productName",
    "shortDescDe",
    "longDescDe",
    "shortDescEn",
    "longDescEn",
    "seoTitle",
    "seoDescription",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Du schreibst Produkttexte für Marinell, eine hochwertige Schmuckmarke, im Stil
großer Schmuckhäuser wie Tiffany & Co.: Die Texte sollen nicht nur Fakten auflisten, sondern eine
emotionale Wirkung entfalten - Gefühl, Anlass, Design-Charakter, Tragegefühl, Lichtspiel der Steine -
und diese Emotion mit den Fakten verweben, statt eine reine Spezifikationsliste zu sein.

Du bekommst ausschließlich strukturierte Produktdaten (Material, Legierung, Diamant-/Farbstein-Details,
Maße). Du bekommst KEINE Freitext-Artikelbeschreibung - das ist Absicht.

Regeln:
- Verwende NUR die gelieferten Fakten für alle konkreten Aussagen (Karat, Reinheit, Zertifikate, Maße,
  Material). Erfinde keine Steindetails - das sind Vertrauensgüter, Faktentreue hat Vorrang.
- Emotionale Sprache ist ausdrücklich erwünscht und KEIN Faktenverstoß, solange sie keine konkreten
  Behauptungen über Stein/Material erfindet: Stimmung, Anlass ("ein Statement für besondere Momente"),
  Trageerlebnis, Design-Charakter, zeitlose Eleganz. Die Langbeschreibung beginnt bevorzugt mit einem
  emotionalen/atmosphärischen Satz, bevor die Fakten folgen - nicht umgekehrt.
- Der Produktname ist ein Markenname im Stil eines Schmuckhauses, kein technischer Modellcode.
- Ton: hochwertig, gefühlvoll, aber nicht kitschig überladen - elegant-zurückhaltend wie Tiffany & Co.,
  nicht reißerisch.
- Wenn eine GIA-Zertifikatsnummer angegeben ist, hebe sie explizit hervor (starkes Kaufargument bei
  einem Vertrauensgut) - eingebettet in einen Satz über Vertrauen/Qualität, nicht als trockene
  Aufzählung.
- shortDesc: 1-2 Sätze, mit spürbarem emotionalem Ton. longDesc: 4-6 Sätze - erst Emotion/Anlass/
  Charakter, dann Fakten eingewoben, kein reiner Spezifikations-Absatz. seoTitle: max. 60 Zeichen.
  seoDescription: max. 155 Zeichen (SEO-Felder bleiben faktisch/klar, da sie in Suchergebnissen
  erscheinen).
- longDescEn/shortDescEn/seoTitle (falls auf Englisch sinnvoll) sind eigenständige Übersetzungen,
  keine wörtliche Übersetzung der deutschen Texte, aber faktisch identisch.`;

function buildProductFacts(product: SourceProductRow): Record<string, unknown> {
  const raw = product.rawJson ?? {};

  return {
    hauptkategorie: product.hauptkategorie,
    kategorieEbene1: product.kategorieEbene1,
    kategorieEbene2: product.kategorieEbene2,
    kategorieEbene3: product.kategorieEbene3,
    hauptmaterial: product.hauptmaterial,
    legierung: product.legierung,
    legierungsgewicht: product.legierungsgewicht,
    diamantUebersicht: {
      caratur: product.caratur,
      anzahlSteine: product.anzahlSteine,
      schliffguete: product.diamantSchliffguete,
      farbe: product.diamantFarbe,
      reinheit: product.diamantReinheit,
    },
    diamantSlots: diamondSlots(raw),
    farbsteinUebersicht: {
      caratur: product.caraturFarbstein,
      anzahlSteine: product.anzahlSteineFarbstein,
    },
    farbsteinSlots: coloredStoneSlots(raw),
    ringgroesse: product.ringgroesse,
    hoehe: product.hoehe,
    breite: product.breite,
    durchmesser: product.durchmesser,
    staerke: product.staerke,
    produktLaengeCm: product.produktLaengeCm,
    giaZertifikatNr: product.giaZertifikatNr,
  };
}

export async function generateProductContent(product: SourceProductRow): Promise<GeneratedContent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt (.env.local prüfen).");
  }

  const client = new Anthropic({ apiKey });
  const facts = buildProductFacts(product);

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Erzeuge die Produkttexte für dieses Schmuckstück (JSON-Fakten):\n\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude hat die Anfrage aus Sicherheitsgründen abgelehnt.");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude hat keinen Text zurückgegeben.");
  }

  let parsed: GeneratedContent;
  try {
    parsed = JSON.parse(textBlock.text) as GeneratedContent;
  } catch {
    throw new Error("Claude-Antwort war kein valides JSON.");
  }

  return parsed;
}
