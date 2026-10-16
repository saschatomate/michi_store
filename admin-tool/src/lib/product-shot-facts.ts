// Reine Konstanten für den "Produktbild"-Weg (Schmuckstück liegend auf einem Hintergrund, ohne
// Model) - bewusst ohne "server-only", weil die Auswahl auch im Client (GeneratedImagesSection)
// gerendert wird. Die eigentliche Generierung liegt in product-shot.ts.

export type ProductShotBackground = {
  key: string;
  label: string;
  tagline: string;
  // Szenenbeschreibung für den Bild-Prompt: Untergrund + passende Lichtstimmung.
  promptDescriptor: string;
};

export const PRODUCT_SHOT_BACKGROUNDS: ProductShotBackground[] = [
  {
    key: "lava",
    label: "Dunkles Lavagestein",
    tagline: "Schwarz-anthrazit, porös und rau - starker Kontrast zu hellem Metall.",
    promptDescriptor:
      "ein Stück dunkles, poröses Lavagestein mit rauer, matter Oberfläche in Schwarz und Anthrazit; " +
      "weiches, gerichtetes Seitenlicht, das die Struktur des Gesteins betont",
  },
  {
    key: "satin",
    label: "Satintuch",
    tagline: "Weich fallendes Satintuch in gedecktem Champagner/Elfenbein.",
    promptDescriptor:
      "ein weich drapiertes Satintuch in gedecktem Champagner-Elfenbein mit sanften Falten und " +
      "seidigem Glanz; warmes, diffuses Studiolicht mit weichen Schatten",
  },
  {
    key: "moos",
    label: "Moos",
    tagline: "Tiefgrünes, feines Waldmoos - organisch und natürlich.",
    promptDescriptor:
      "ein dichtes Polster aus feinem, tiefgrünem Waldmoos mit natürlicher Struktur; weiches " +
      "Tageslicht wie im Schatten eines Waldes",
  },
  {
    key: "erde",
    label: "Erde",
    tagline: "Feuchte, dunkle Walderde mit feiner Körnung.",
    promptDescriptor:
      "dunkle, leicht feuchte Walderde mit feiner Körnung und kleinen natürlichen Texturen; weiches " +
      "natürliches Licht mit warmem Unterton",
  },
  {
    key: "stein",
    label: "Heller Naturstein",
    tagline: "Glatter, ruhiger Stein in Hellgrau/Sandfarben (Plain).",
    promptDescriptor:
      "eine ruhige, glatte Platte aus hellgrauem bis sandfarbenem Naturstein ohne auffällige Maserung; " +
      "klares, weiches Tageslicht mit dezenten Schatten",
  },
  {
    key: "holz",
    label: "Holzfliese",
    tagline: "Warme Holzfliese mit feiner Maserung.",
    promptDescriptor:
      "eine warme, matt geölte Holzfliese aus Eiche oder Nussbaum mit feiner, ruhiger Maserung; " +
      "weiches, warmes Licht von der Seite",
  },
];

// Eine Variante pro Slot (variantIndex 0-2), damit die 3 Karten im Grid unterschiedliche
// Bildausschnitte desselben Hintergrunds zeigen statt dreimal derselben Komposition.
export const PRODUCT_SHOT_COMPOSITIONS: { key: string; label: string; promptDescriptor: string }[] = [
  {
    key: "flatlay",
    label: "Von oben",
    promptDescriptor:
      "Draufsicht aus ca. 90 Grad (Flat Lay), das Schmuckstück liegt zentriert und vollständig " +
      "sichtbar im Bild mit großzügigem Abstand zum Rand",
  },
  {
    key: "schraeg",
    label: "Schräg",
    promptDescriptor:
      "Schrägansicht aus ca. 35 Grad, das Schmuckstück liegt leicht aus der Mitte versetzt " +
      "(Drittelregel), geringe Tiefenschärfe im Hintergrund, Schmuckstück vollständig scharf",
  },
  {
    key: "detail",
    label: "Nahaufnahme",
    promptDescriptor:
      "enge Nahaufnahme aus flachem Winkel auf das Schmuckstück, Fokus auf Metall und Steine, " +
      "Hintergrund weich auslaufend; das Schmuckstück bleibt trotzdem erkennbar vollständig",
  },
];

export const PRODUCT_SHOT_LABEL_PREFIX = "Produktbild";

export function productShotLabel(background: ProductShotBackground, compositionIndex: number): string {
  const composition = PRODUCT_SHOT_COMPOSITIONS[compositionIndex] ?? PRODUCT_SHOT_COMPOSITIONS[0];
  return `${PRODUCT_SHOT_LABEL_PREFIX} – ${background.label} – ${composition.label}`;
}

// Rückweg für "Neu" pro Slot: aus dem gespeicherten Label (kein eigenes DB-Feld, analog zum
// "(Compositing)"-Suffix) wieder den Hintergrund ermitteln. null, falls das Bild kein Produktbild ist.
export function backgroundFromLabel(label: string | null | undefined): ProductShotBackground | null {
  if (!label?.startsWith(`${PRODUCT_SHOT_LABEL_PREFIX} – `)) return null;
  const labelPart = label.split(" – ")[1]?.trim();
  return PRODUCT_SHOT_BACKGROUNDS.find((b) => b.label === labelPart) ?? null;
}
