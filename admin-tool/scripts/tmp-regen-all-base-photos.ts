import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { MARINELL_MODELS, POSE_VARIANTS, bodyPartMapping, type ModelKey } from "../src/lib/image-facts";

const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

const STYLE_BEFORE_CLOTHING =
  "Kontext: Dies ist professionelle E-Commerce-/Katalog-Produktfotografie für eine seriöse " +
  "Fine-Jewellery-Marke, ausschließlich zur Präsentation eines einzelnen Schmuckstücks am Körper " +
  "(vergleichbar mit Tiffany & Co., Cartier oder Van Cleef & Arpels Kampagnenbildern). KEINE " +
  "erotische, sexualisierte, anzügliche oder freizügige Darstellung - das Model ist vollständig " +
  "und dezent bekleidet, Pose und Ausdruck sind neutral-elegant wie in einem Modemagazin- oder " +
  "Werbekatalog-Shooting, nicht intim oder suggestiv. " +
  "MARINELL Editorial-Luxus-Schmuckfotografie: 'Luxury, lived discreetly' - die Bildsprache ist " +
  "leise, ruhig, nie laut oder aufdringlich. Großzügiger, eleganter Bildausschnitt. Hintergrund: " +
  "champagnerfarbener Seiden-/Satinvorhang mit weichen Falten, oder alternativ ein warmer, heller " +
  "Sandton-Studiohintergrund ohne sichtbare Struktur oder Requisiten - Farbwelt durchgehend Ivory, " +
  "Champagne, Warm Sand, Cashmere, Black, Warm Gold, Soft Taupe. Licht: warmes 'Golden Hour'/" +
  "Champagnerlicht - großes, weiches Beauty-Light von links oben, warme Farbtemperatur, feines " +
  "Kantenlicht, sanfte Schatten, keine harten Reflexe. Ruhige, unaufdringliche, professionelle " +
  "Ausstrahlung. ";

const CLOTHING_BY_GENDER: Record<string, string> = {
  weiblich:
    "Kleidung: schwarzes seidenes Abendkleid mit schmalen Trägern, champagnerfarbenes Satinkleid " +
    "oder cremefarbener Kaschmir/Blazer - schlicht, ohne Muster oder Logos. Kleidung sitzt immer " +
    "vollständig bedeckend, nicht durchsichtig und nicht freizügig. ",
  männlich:
    "Kleidung: cremefarbener Kaschmir-/Rollkragenpullover, offenes weißes oder schwarzes " +
    "Leinenhemd oder schlicht geschnittener schwarzer Blazer - schlicht, ohne Muster oder Logos. ",
};

const NO_JEWELRY_EMPHATIC =
  "KRITISCH UND NICHT VERHANDELBAR: Es ist AUSDRÜCKLICH KEIN Schmuck jeglicher Art im Bild " +
  "sichtbar - keine Ohrringe, keine Kette/kein Anhänger, keine Ringe, keine Armbänder/Armreifen, " +
  "keine Uhr -, auch nicht dezent, teilweise verdeckt oder nur angedeutet. Falls eine Hand im Bild " +
  "zu sehen ist: sie trägt AUSDRÜCKLICH KEINEN Ring an IRGENDEINEM Finger, obwohl die Pose an ein " +
  "Verlobungsring-Foto erinnern könnte - alle Finger komplett nackt. Dieses Foto ist eine " +
  "absichtlich komplett schmucklose Vorlage für spätere digitale Bearbeitung. ";

const STYLE_AFTER_CLOTHING =
  "Natürliche Retusche: echte Hautstruktur mit sichtbaren Poren bleibt erhalten, keine Plastikhaut, " +
  "keine übertriebene Beauty-Retusche. Ruhige editorial Farbgebung mit sanftem Kontrast. Kein Text, " +
  "kein Logo, kein Wasserzeichen im Bild. " +
  "KRITISCH bei Händen (falls im Bild): genau fünf Finger inklusive sichtbarem Daumen, jeder " +
  "Finger einzeln und klar voneinander getrennt, natürliche Proportionen und Gelenke. Die GANZE " +
  "Hand liegt flach und entspannt, alle vier Finger nebeneinander klar sichtbar und leicht " +
  "voneinander gespreizt (NICHT Faust, NICHT verschränkt, NICHT nur eine einzelne Fingerspitze " +
  "angedeutet, NICHT stark eingerollt).";

type Category = "Colliers" | "Ring" | "Ohrschmuck";
const CATEGORY_SHORT: Record<Category, string> = { Colliers: "hals", Ring: "ring", Ohrschmuck: "ohr" };

async function generateOne(modelKey: ModelKey, poseKey: string, category: Category) {
  const model = MARINELL_MODELS[modelKey];
  const pose = POSE_VARIANTS.find((p) => p.key === poseKey)!;
  const mapping = bodyPartMapping(category)!;

  const refBuffer = await fetch(model.referenceImageUrl).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b));
  const refFile = await toFile(refBuffer, "model-reference", { type: "image/jpeg" });

  const prompt =
    `${STYLE_BEFORE_CLOTHING}${CLOTHING_BY_GENDER[model.gender]}${NO_JEWELRY_EMPHATIC}${STYLE_AFTER_CLOTHING} ` +
    `Dir wird EIN Bild gegeben: ein echtes Foto des Models ${model.name}. Erzeuge ein NEUES Foto ` +
    `desselben Models - identisches Gesicht, identische Haare, identischer Hautunterton, gleicher ` +
    `fotografischer Stil - aber in einer NEUEN Pose/Komposition: ${mapping.compositionHint}. ` +
    `Zeige ${pose.promptDescriptor}. Erinnerung: KEIN Schmuck jeglicher Art. ` +
    `Hohe Auflösung, scharfer Fokus.`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 8 });
  const response = await client.images.edit({
    image: refFile,
    prompt,
    model: "gpt-image-1.5",
    size: mapping.size,
    quality: "high",
    input_fidelity: "high",
    output_format: "png",
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Kein Bild für ${modelKey}-${poseKey}-${category}`);
  const short = CATEGORY_SHORT[category];
  const outPath = `${DIR}/newbase-${modelKey}-${poseKey}-${short}.png`;
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
  console.log("OK", outPath);
}

async function main() {
  const modelKey = process.argv[2] as ModelKey;
  if (!modelKey) throw new Error("Model-Key als Argument angeben (sophia|claire|jen|amara)");
  // Optionales 3. Argument: kommagetrennte Liste "pose:kategorie" statt aller 9 Kombinationen -
  // für gezielte Wiederholung nach einem Teilfehler (Promise.all bricht bei EINEM Fehler die ganze
  // Charge ab, siehe Claire-Vorfall: 1 von 9 Aufrufen von OpenAIs Sicherheitssystem abgelehnt
  // [safety_violations=sexual], dadurch 7 von 9 nie versucht).
  const only = process.argv[3];
  let combos: { pose: string; category: Category }[];
  if (only) {
    combos = only.split(",").map((s) => {
      const [pose, category] = s.split(":");
      return { pose, category: category as Category };
    });
  } else {
    const poses = ["frontal", "dreiviertelprofil", "seitlich"];
    const categories: Category[] = ["Colliers", "Ring", "Ohrschmuck"];
    combos = categories.flatMap((category) => poses.map((pose) => ({ pose, category })));
  }
  const results = await Promise.allSettled(
    combos.map(({ pose, category }) => generateOne(modelKey, pose, category)),
  );
  const failed = results
    .map((r, i) => ({ r, combo: combos[i] }))
    .filter(({ r }) => r.status === "rejected");
  for (const { r, combo } of failed) {
    console.error(`FEHLGESCHLAGEN: ${combo.pose}:${combo.category}`, (r as PromiseRejectedResult).reason?.message ?? r);
  }
  console.log("done for", modelKey, "-", failed.length, "von", combos.length, "fehlgeschlagen");
  process.exit(failed.length > 0 ? 1 : 0);
}
main().catch((e) => { console.error("FEHLER:", e); process.exit(1); });
