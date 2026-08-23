import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { MARINELL_MODELS, bodyPartMapping } from "../src/lib/image-facts";

const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

const STYLE_BEFORE_CLOTHING =
  "Kontext: Dies ist professionelle E-Commerce-/Katalog-Produktfotografie für eine seriöse " +
  "Fine-Jewellery-Marke. KEINE erotische, sexualisierte, anzügliche oder freizügige Darstellung - " +
  "das Model ist vollständig und dezent bekleidet, Pose und Ausdruck sind neutral-elegant. " +
  "MARINELL Editorial-Luxus-Schmuckfotografie: 'Luxury, lived discreetly' - die Bildsprache ist " +
  "leise, ruhig. Großzügiger, eleganter Bildausschnitt. Hintergrund: champagnerfarbener Seiden-/" +
  "Satinvorhang mit weichen Falten. Licht: warmes 'Golden Hour'/Champagnerlicht - großes, weiches " +
  "Beauty-Light von links oben, warme Farbtemperatur, feines Kantenlicht, sanfte Schatten. ";

const CLOTHING_WEIBLICH =
  "Kleidung: schwarzes seidenes Abendkleid mit schmalen Trägern - schlicht, ohne Muster oder Logos. ";

const NO_JEWELRY_EMPHATIC =
  "KRITISCH: Die abgebildete Hand trägt AUSDRÜCKLICH KEINEN Ring an IRGENDEINEM Finger - alle " +
  "Finger sind komplett nackt und schmucklos. Kein Schmuckstück irgendeiner Art an Hand, Ohr, Hals " +
  "oder Handgelenk. ";

const STYLE_AFTER_CLOTHING =
  "Natürliche Retusche: echte Hautstruktur mit sichtbaren Poren bleibt erhalten. " +
  "KRITISCH bei Händen: genau fünf Finger inklusive sichtbarem Daumen, jeder Finger einzeln und " +
  "klar voneinander getrennt. Die GANZE Hand liegt flach und entspannt, alle vier Finger " +
  "nebeneinander klar sichtbar und leicht voneinander gespreizt.";

async function main() {
  const model = MARINELL_MODELS.amara;
  const mapping = bodyPartMapping("Ring")!;

  const refBuffer = await fetch(model.referenceImageUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b));
  const refFile = await toFile(refBuffer, "model-reference", { type: "image/jpeg" });

  const prompt =
    `${STYLE_BEFORE_CLOTHING}${CLOTHING_WEIBLICH}${NO_JEWELRY_EMPHATIC}${STYLE_AFTER_CLOTHING} ` +
    `Dir wird EIN Bild gegeben: ein echtes Foto des Models ${model.name}. Erzeuge ein NEUES Foto ` +
    `desselben Models - identisches Gesicht, identische Haare, identischer Hautunterton, gleicher ` +
    `fotografischer Stil - aber in einer NEUEN Pose/Komposition: ${mapping.compositionHint}. ` +
    `Frontale Nahaufnahme mit direktem, ruhigem Blick in die Kamera. ` +
    `Erinnerung: KEIN Ring an keinem Finger. Hohe Auflösung, scharfer Fokus.`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 6 });
  const response = await client.images.edit({
    image: refFile,
    prompt,
    model: "gpt-image-1.5",
    size: "1024x1536",
    quality: "high",
    input_fidelity: "high",
    output_format: "png",
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Kein Bild");
  fs.writeFileSync(`${DIR}/base-amara-frontal-ring-WITHREF.png`, Buffer.from(b64, "base64"));
  console.log("OK");
  process.exit(0);
}
main().catch(e => { console.error("FEHLER:", e); process.exit(1); });
