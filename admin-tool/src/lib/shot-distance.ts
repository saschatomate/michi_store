// Bewusst ohne "server-only": die Auswahl wird im Browser (Dropdown) und im Prompt-Bau genutzt.
// Die Distanz ist eine Bildwirkung, keine echte Messung - die Bild-KI setzt sie nur ungefähr um.
export type ShotDistance = { key: string; label: string; prompt: string | null };

export const SHOT_DISTANCES: ShotDistance[] = [
  { key: "auto", label: "Automatisch (keine Vorgabe)", prompt: null },
  {
    key: "makro",
    label: "Makro – ca. 8 cm",
    prompt:
      "Aufnahmedistanz: extreme Nahaufnahme (Makro) aus ca. 8 cm Abstand. Das Schmuckstück füllt den Bildausschnitt " +
      "fast vollständig, Fokus auf Metall und Steine; der Hintergrund ist nur noch als weiche Struktur sichtbar",
  },
  {
    key: "nah",
    label: "Nah – ca. 15 cm",
    prompt:
      "Aufnahmedistanz: Nahaufnahme aus ca. 15 cm Abstand. Das Schmuckstück ist groß im Bild, der Hintergrund bleibt " +
      "als Material deutlich erkennbar",
  },
  {
    key: "mittel",
    label: "Mittel – ca. 25 cm",
    prompt:
      "Aufnahmedistanz: mittlere Distanz aus ca. 25 cm Abstand. Das Schmuckstück nimmt etwa die Hälfte der Bildbreite " +
      "ein, rundherum ist ausreichend Hintergrund zu sehen",
  },
  {
    key: "weit",
    label: "Weit – ca. 40 cm",
    prompt:
      "Aufnahmedistanz: größere Distanz aus ca. 40 cm Abstand. Das Schmuckstück nimmt etwa ein Drittel des Bildes ein, " +
      "viel Hintergrund und eine ruhige, großzügige Komposition",
  },
];

export function distancePrompt(key: string | null | undefined): string | null {
  return SHOT_DISTANCES.find((d) => d.key === key)?.prompt ?? null;
}
