// Bewusst ohne "server-only": Auswahl im Browser (Dropdown) und Validierung im Server-Code.
// Qualitätsstufe der OpenAI-Bildgenerierung: niedriger = schneller und günstiger, hoch = mehr Detail.
export type ImageQuality = "low" | "medium" | "high";

export const IMAGE_QUALITIES: { key: ImageQuality; label: string }[] = [
  { key: "high", label: "Hoch (langsamer, bester Detailgrad)" },
  { key: "medium", label: "Mittel (schneller)" },
  { key: "low", label: "Niedrig (am schnellsten, Entwurf)" },
];

export const DEFAULT_IMAGE_QUALITY: ImageQuality = "high";

// Unbekannte oder fehlende Werte fallen auf den Standard zurück, damit ein alter Auftrag nie scheitert.
export function parseImageQuality(value: string | null | undefined): ImageQuality {
  return value === "low" || value === "medium" || value === "high" ? value : DEFAULT_IMAGE_QUALITY;
}
