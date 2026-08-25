import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { sourceProducts } from "@/db/schema";
import { diamondSlots, coloredStoneSlots } from "@/lib/product-facts";
import { estimateClaudeTextCost, recordApiUsage } from "@/lib/cost-tracking";

const CLAUDE_MODEL = "claude-opus-4-8";

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

const SYSTEM_PROMPT = `Du schreibst Produkttexte für MARINELL, ein modernes Jewellery House mit dem
Markenversprechen "Luxury, lived discreetly". Die Markensprache ist leise, ruhig, nie laut oder
aufdringlich - wahrer Luxus zeigt sich bei MARINELL nicht durch Auftritt oder Status, sondern durch
Vertrauen, Zeitlosigkeit und die Erinnerung, die ein Schmuckstück begleitet. Jedes Stück erzählt eine
Geschichte - ein Antrag im kleinen Kreis, ein Geschenk, ein Erbstück über Generationen - nicht eine
Werbebotschaft.

Du bekommst ausschließlich strukturierte Produktdaten (Material, Legierung, Diamant-/Farbstein-Details,
Maße). Du bekommst KEINE Freitext-Artikelbeschreibung - das ist Absicht.

Regeln:
- Verwende NUR die gelieferten Fakten für alle konkreten Aussagen (Karat, Reinheit, Zertifikate, Maße,
  Material). Erfinde keine Steindetails - das sind Vertrauensgüter, Faktentreue hat Vorrang.
- Emotionale Sprache ist ausdrücklich erwünscht und KEIN Faktenverstoß, solange sie keine konkreten
  Behauptungen über Stein/Material erfindet: Vertrauen, Zeitlosigkeit, ein bedeutender Moment, das
  Tragegefühl, die Ruhe des Designs - nie Status, Reichtum oder Auffälligkeit. Die Langbeschreibung
  beginnt bevorzugt mit einem emotionalen/atmosphärischen Satz, bevor die Fakten folgen - nicht
  umgekehrt.
- Der Produktname ist ein zurückhaltender Markenname im Stil eines Jewellery House, kein technischer
  Modellcode und ohne Eigennamen von Personen.
- Ton: leise, diskret, warm - niemals reißerisch, niemals lautstarke Superlative ("atemberaubend",
  "spektakulär"). Zurückhaltung ist bei MARINELL selbst ein Qualitätsmerkmal.
- Wenn eine GIA-Zertifikatsnummer angegeben ist, hebe sie explizit hervor (starkes Vertrauensargument
  bei einem Vertrauensgut) - eingebettet in einen Satz über Sorgfalt/Qualität, nicht als trockene
  Aufzählung. GIA-zertifizierte Naturdiamanten gehören zur "MARINELL Fine Jewellery Collection"; ohne
  GIA-Zertifikat (z.B. Lab-Grown-Diamanten in 14kt) zur "MARINELL Lab Collection" - erwähne die
  passende Kollektion beiläufig in Kurz- oder Langbeschreibung, wo es natürlich passt.
- shortDesc: 1-2 Sätze, ruhiger emotionaler Ton. longDesc: 4-6 Sätze - erst Emotion/Anlass/Charakter,
  dann Fakten eingewoben, kein reiner Spezifikations-Absatz. seoTitle: max. 60 Zeichen. seoDescription:
  max. 155 Zeichen (SEO-Felder bleiben faktisch/klar, da sie in Suchergebnissen erscheinen).
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
    model: CLAUDE_MODEL,
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

  // Kosten werden verbucht, sobald die Antwort da ist - unabhängig davon, ob sie danach als
  // Refusal oder ungültiges JSON verworfen wird. Das Geld für den Aufruf ist in jedem Fall weg.
  await recordApiUsage({
    provider: "anthropic",
    purpose: "text_generation",
    sourceProductId: product.id,
    model: CLAUDE_MODEL,
    usage: response.usage,
    costUsd: estimateClaudeTextCost(CLAUDE_MODEL, response.usage),
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

// Kurze, gezielte Vision-Analyse NUR der Kette (nicht des Anhängers) im echten Produktfoto - liefert
// eine deutsche Kurzbeschreibung (Gliederart/Dicke/Finish), die in den Ketten-Generierungs-Prompt von
// generateChainViaMask() (image-compositing.ts) einfließt, damit die KI-generierte Kette dem echten
// Produkt ähnelt statt geraten zu werden. Diamond-Group liefert dafür keine strukturierten Metadaten
// (langBezeichnungDe hat nur H/B/L/S in mm/cm, keine Gliederart) - der einzige Weg, die tatsächliche
// Kette zu kennen, ist ein Blick auf das Foto selbst.
//
// BEWUSST eine separate reine Text-Antwort (kein Bild-Output), nicht das Produktfoto direkt in
// generateChainViaMask() geben: ein früherer Versuch, das Produktfoto dort als zweites Bild
// anzuhängen, hat gpt-image-1.5 dazu gebracht, nicht nur die Kette zu übernehmen, sondern die
// komplette Bildkomposition zu verwerfen (Pose/Gesicht/Hintergrund neu generiert, siehe Kommentar
// dort). Diese Funktion berührt den riskanten Bild-Editier-Aufruf gar nicht - nur ein kurzer, klar
// abgegrenzter Textsatz geht anschließend in dessen Prompt ein, das eigentliche Ketten-Bild bleibt
// weiterhin ohne Produktfoto-Referenz.
export async function describeChainForImagePrompt(
  productImageBuffer: Buffer,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  sourceProductId: number,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system:
      "Du beschreibst NUR die Kette (nicht den Anhänger/die Fassung/die Steine) eines " +
      "Schmuckstück-Produktfotos in einem einzigen kurzen, prägnanten deutschen Satz, geeignet als " +
      "Stilvorgabe für eine Bildgenerierung: Gliederart (z.B. Anker-, Venezianer-, Figaro-, Panzer-, " +
      "Kugelkette), ungefähre Gliedform/-größe und Oberflächenfinish (poliert/matt/diamantiert). " +
      "Falls keine Kette erkennbar ist (z.B. reines Ring-/Ohrschmuckfoto), antworte NUR mit dem Wort " +
      "'unklar'. Keine Einleitung, keine Erklärung, nur der eine Satz bzw. das eine Wort.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: productImageBuffer.toString("base64") } },
          { type: "text", text: "Beschreibe die Kette in diesem Produktfoto." },
        ],
      },
    ],
  });

  await recordApiUsage({
    provider: "anthropic",
    purpose: "text_generation",
    sourceProductId,
    model: CLAUDE_MODEL,
    usage: response.usage,
    costUsd: estimateClaudeTextCost(CLAUDE_MODEL, response.usage),
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const description = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  if (!description || description.toLowerCase().includes("unklar")) return null;
  return description;
}
