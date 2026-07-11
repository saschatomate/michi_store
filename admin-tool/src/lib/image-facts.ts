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
    compositionHint: "Nahaufnahme eines Handgelenks und Unterarms, Armband am Handgelenk getragen",
    size: "1536x1024",
  },
  Armreifen: {
    bodyPart: "ein Handgelenk",
    compositionHint: "Nahaufnahme eines Handgelenks und Unterarms, Armreif am Handgelenk getragen",
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

// Feste 3 Presets pro Generierungslauf für die geforderte Diversität (Hautton + Handform/-größe).
export const HAND_PRESETS: HandPreset[] = [
  {
    key: "hell_schlank",
    label: "Heller Hautton, schlank",
    promptDescriptor: "eine schlanke Hand/Körperpartie mit hellem Hautton",
  },
  {
    key: "mittel_standard",
    label: "Mittlerer Hautton, durchschnittlich",
    promptDescriptor: "eine durchschnittlich gebaute Hand/Körperpartie mit mittlerem, warmem Hautton",
  },
  {
    key: "dunkel_kraeftig",
    label: "Dunkler Hautton, kräftiger",
    promptDescriptor: "eine kräftigere, vollere Hand/Körperpartie mit dunklem Hautton",
  },
];
