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
    compositionHint:
      "Extreme Nahaufnahme einer Hand nahe Schlüsselbein/Dekolleté oder frei vor neutralem " +
      "Hintergrund. Die Hand ist offen und entspannt, die Finger sanft gestreckt und leicht " +
      "voneinander gespreizt (NICHT zur Faust geballt, NICHT ineinander verschränkt oder stark " +
      "gekrümmt) - jeder Finger muss klar einzeln erkennbar sein, ohne dass sich benachbarte " +
      "Finger berühren oder überlappen. Der Ringfinger, auf dem der Ring sitzt, ist deutlich von " +
      "den Nachbarfingern abgesetzt sichtbar. Ring scharf im Fokus, restliche Hand und Umgebung " +
      "durch Schärfentiefe leicht weich",
    size: "1024x1536",
  },
  Ohrschmuck: {
    bodyPart: "ein Ohr",
    compositionHint:
      "Extreme Nahaufnahme von Ohr und oberem Hals, Kopf leicht seitlich gedreht, Haare aus dem " +
      "Gesicht/vom Ohr weggehalten (zurückgebunden oder hinters Ohr gelegt), sodass der Ohrschmuck " +
      "frei sichtbar ist, Schmuckstück scharf im Fokus, Haare und Hintergrund weich unscharf",
    size: "1024x1536",
  },
  Colliers: {
    bodyPart: "Hals und Dekolleté",
    compositionHint:
      "Enge Beauty-Nahaufnahme: unterer Gesichtsbereich (Nase/Mund, am oberen Bildrand " +
      "angeschnitten) bis Hals und oberes Dekolleté sichtbar, Kamera nahezu frontal mit leichtem " +
      "Winkel. Kragen oder Ausschnitt der Kleidung (z.B. Hemdkragen oder Blazer-Revers, schlicht " +
      "und neutral in Schwarz oder Weiß) am unteren Bildrand sichtbar und Teil der Komposition. " +
      "Schmuckstück auf der Haut liegend scharf im Fokus, alles andere leicht weich",
    size: "1024x1536",
  },
  Anhänger: {
    bodyPart: "Hals und Dekolleté",
    compositionHint:
      "Enge Beauty-Nahaufnahme: unterer Gesichtsbereich (Nase/Mund, am oberen Bildrand " +
      "angeschnitten) bis Hals und oberes Dekolleté sichtbar, Kamera nahezu frontal mit leichtem " +
      "Winkel. Kragen oder Ausschnitt der Kleidung (z.B. Hemdkragen oder Blazer-Revers, schlicht " +
      "und neutral in Schwarz oder Weiß) am unteren Bildrand sichtbar und Teil der Komposition. " +
      "Anhänger an einer Kette auf der Haut liegend scharf im Fokus, alles andere leicht weich",
    size: "1024x1536",
  },
  Armbänder: {
    bodyPart: "ein Handgelenk",
    compositionHint:
      "Extreme Nahaufnahme eines Handgelenks und Unterarms, oft in sanfter Interaktion mit der " +
      "anderen Hand (z.B. Hände sanft übereinander oder ineinander verschränkt nahe Schlüsselbein) " +
      "oder Unterarm hängend mit entspannt positionierten Fingern, Armband scharf im Fokus, " +
      "restlicher Arm, zweite Hand und Hintergrund durch Schärfentiefe weich. Achtung: Bei " +
      "Armbändern ist die Innen-/Außenseite im Referenzfoto oft nicht eindeutig erkennbar - behalte " +
      "die im Referenzbild sichtbare Anordnung der Elemente exakt bei, anstatt sie zu erraten oder " +
      "zu vertauschen",
    size: "1024x1536",
  },
  Armreifen: {
    bodyPart: "ein Handgelenk",
    compositionHint:
      "Extreme Nahaufnahme eines Handgelenks und Unterarms, oft in sanfter Interaktion mit der " +
      "anderen Hand (z.B. Hände sanft übereinander oder ineinander verschränkt nahe Schlüsselbein) " +
      "oder Unterarm hängend mit entspannt positionierten Fingern, Armreif scharf im Fokus, " +
      "restlicher Arm, zweite Hand und Hintergrund durch Schärfentiefe weich. Achtung: Bei " +
      "Armreifen ist die Innen-/Außenseite im Referenzfoto oft nicht eindeutig erkennbar - behalte " +
      "die im Referenzbild sichtbare Anordnung der Elemente exakt bei, anstatt sie zu erraten oder " +
      "zu vertauschen",
    size: "1024x1536",
  },
  Manschettenknöpfe: {
    bodyPart: "eine Hemdmanschette am Handgelenk",
    compositionHint:
      "Extreme Nahaufnahme eines Handgelenks mit Hemdmanschette, Manschettenknopf geschlossen und " +
      "scharf im Fokus, schlichter Hemdärmel, Hintergrund durch Schärfentiefe weich",
    size: "1024x1536",
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
