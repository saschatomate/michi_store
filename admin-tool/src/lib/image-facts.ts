export type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";

export type BodyPartMapping = {
  bodyPart: string;
  compositionHint: string;
  size: ImageSize;
};

// Kategorie-Verteilung im Katalog (Stand Import): Ring 3869, Ohrschmuck 2311, Colliers 1440,
// Armbänder 596, Anhänger 472, Armreifen 177, Manschettenknöpfe 3, Schließen 1.
const BODY_PART_BY_HAUPTKATEGORIE: Record<string, BodyPartMapping> = {
  Ring: {
    bodyPart: "eine Hand",
    compositionHint: "Nahaufnahme einer Hand mit dem Ring an einem Finger, Fokus auf Hand und Finger",
    size: "1536x1024",
  },
  Ohrschmuck: {
    bodyPart: "ein Ohr",
    compositionHint: "Nahaufnahme eines Ohrs und der Halsseite, Schmuckstück am Ohr getragen",
    size: "1024x1536",
  },
  Colliers: {
    bodyPart: "Hals und Dekolleté",
    compositionHint: "Nahaufnahme von Hals und Dekolleté, Schmuckstück um den Hals getragen",
    size: "1024x1536",
  },
  Anhänger: {
    bodyPart: "Hals und Dekolleté",
    compositionHint: "Nahaufnahme von Hals und Dekolleté, Anhänger an einer Kette um den Hals getragen",
    size: "1024x1536",
  },
  Armbänder: {
    bodyPart: "ein Handgelenk",
    compositionHint:
      "Nahaufnahme eines Handgelenks und Unterarms, Armband am Handgelenk getragen. Achtung: Bei " +
      "Armbändern ist die Innen-/Außenseite im Referenzfoto oft nicht eindeutig erkennbar - behalte " +
      "die im Referenzbild sichtbare Anordnung der Elemente exakt bei, anstatt sie zu erraten oder " +
      "zu vertauschen",
    size: "1536x1024",
  },
  Armreifen: {
    bodyPart: "ein Handgelenk",
    compositionHint:
      "Nahaufnahme eines Handgelenks und Unterarms, Armreif am Handgelenk getragen. Achtung: Bei " +
      "Armreifen ist die Innen-/Außenseite im Referenzfoto oft nicht eindeutig erkennbar - behalte " +
      "die im Referenzbild sichtbare Anordnung der Elemente exakt bei, anstatt sie zu erraten oder " +
      "zu vertauschen",
    size: "1536x1024",
  },
  Manschettenknöpfe: {
    bodyPart: "eine Hemdmanschette am Handgelenk",
    compositionHint: "Nahaufnahme eines Handgelenks mit Hemdmanschette, Manschettenknopf geschlossen sichtbar",
    size: "1536x1024",
  },
};

export function bodyPartMapping(hauptkategorie: string | null): BodyPartMapping | null {
  if (!hauptkategorie) return null;
  return BODY_PART_BY_HAUPTKATEGORIE[hauptkategorie] ?? null;
}

export type HandPreset = {
  key: string;
  label: string;
  promptDescriptor: string;
};

// Hautton und Handform/-größe sind zwei unabhängige Achsen - werden pro Generierungslauf zufällig
// gemischt und gepaart, damit keine feste Korrelation entsteht (z.B. "dunkler Hautton = kräftiger").
const SKIN_TONES = [
  { key: "hell", label: "Heller Hautton", descriptor: "hellem Hautton" },
  { key: "mittel", label: "Mittlerer Hautton", descriptor: "mittlerem, warmem Hautton" },
  { key: "dunkel", label: "Dunkler Hautton", descriptor: "dunklem Hautton" },
];

const HAND_BUILDS = [
  { key: "schlank", label: "schlank", descriptor: "eine schlanke Hand/Körperpartie" },
  { key: "durchschnittlich", label: "durchschnittlich", descriptor: "eine durchschnittlich gebaute Hand/Körperpartie" },
  { key: "kraeftiger", label: "kräftiger", descriptor: "eine kräftigere, vollere Hand/Körperpartie" },
];

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Erzeugt 3 Presets mit unabhängig zufällig gepaartem Hautton und Handform - bei jedem Aufruf neu
// gemischt, auch bei "Neu generieren".
export function randomHandPresets(): HandPreset[] {
  const tones = shuffled(SKIN_TONES);
  const builds = shuffled(HAND_BUILDS);
  return tones.map((tone, i) => {
    const build = builds[i];
    return {
      key: `${tone.key}_${build.key}`,
      label: `${tone.label}, ${build.label}`,
      promptDescriptor: `${build.descriptor} mit ${tone.descriptor}`,
    };
  });
}
