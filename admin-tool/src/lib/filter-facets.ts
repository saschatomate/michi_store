// Bewusst ohne "server-only": reine Ableitung der Shop-Filterwerte aus den DG-Daten, wird vom Shopify-
// Sync und von der Produktseite genutzt. Nur eindeutig ableitbare Werte; alles Unklare ergibt null
// (statt zu raten) und wird auf der Produktseite als "nicht ableitbar" sichtbar.
import type { sourceProducts } from "@/db/schema";

type FacetInput = Pick<
  typeof sourceProducts.$inferSelect,
  "hauptmaterial" | "legierung" | "diamantSchliffguete" | "caratur" | "hauptkategorie" | "kategorieEbene3"
>;

// Platin ist für den Start bewusst nicht dabei (Entscheidung 2026-11-15).
// Metallfarbe: bei Mischwerten wie "Gelbgold / Weißgold" erscheint das Produkt bei beiden Farben.
// "Rotgold" heißt im Shop "Roségold".
const METAL_COLORS: [RegExp, string][] = [
  [/gelbgold/i, "Gelbgold"],
  [/wei(ß|ss)gold/i, "Weißgold"],
  [/rotgold|ros[ée]gold/i, "Roségold"],
];

export function metalColors(hauptmaterial: string | null): string[] {
  if (!hauptmaterial) return [];
  return METAL_COLORS.filter(([re]) => re.test(hauptmaterial)).map(([, label]) => label);
}

// Nur 14kt und 18kt sind eindeutig. Werte wie "95kt"/"950kt" (vermutlich Platin 950) bleiben bewusst offen,
// bis geklärt ist, was DG damit meint.
const ALLOYS: Record<string, string> = {
  "14kt": "14 kt (585)",
  "18kt": "18 kt (750)",
};

export function alloyLabel(legierung: string | null): string | null {
  return legierung ? (ALLOYS[legierung.trim().toLowerCase()] ?? null) : null;
}

// DG-Schliffbezeichnung -> Shop-Schliffform. Sammelwerte ("Diamant", "Fantasie-Schliff") und Formen
// außerhalb der Filterliste (Herz, Trapez, Triangel) bleiben ohne Schliffform.
const CUT_SHAPES: Record<string, string> = {
  brillant: "Brillant",
  oval: "Oval",
  tropfen: "Tropfen",
  navette: "Navette",
  smaragdschliff: "Emerald",
  princess: "Princess",
  asscher: "Asscher",
  baguette: "Baguette",
  cushion: "Cushion",
};

export function cutShapeLabel(schliff: string | null): string | null {
  return schliff ? (CUT_SHAPES[schliff.trim().toLowerCase()] ?? null) : null;
}

// Karatgruppen für den Filter (Gesamtgewicht). Obergrenze inklusive, Reihenfolge aufsteigend.
export const CARAT_GROUPS: { max: number; label: string }[] = [
  { max: 0.5, label: "bis 0,50 ct" },
  { max: 1, label: "0,51–1,00 ct" },
  { max: 1.5, label: "1,01–1,50 ct" },
  { max: 2, label: "1,51–2,00 ct" },
  { max: Infinity, label: "über 2 ct" },
];

export function caratGroup(caratur: number | null): string | null {
  if (!caratur || caratur <= 0) return null;
  // Auf 2 Nachkommastellen runden, damit 0,3000001 nicht in die nächste Gruppe fällt.
  const ct = Math.round(caratur * 100) / 100;
  return CARAT_GROUPS.find((g) => ct <= g.max)?.label ?? null;
}

// Ringtyp aus Kategorie 3 des DG-Katalogs. Solitaire (auch "mit Besatz") zählt automatisch auch als
// Verlobungsring. Alle anderen Kategorie-3-Werte (z.B. "Modern Woman") ergeben keinen Ringtyp.
export function ringTypeLabel(product: Pick<FacetInput, "hauptkategorie" | "kategorieEbene3">): string | null {
  if (product.hauptkategorie !== "Ring" || !product.kategorieEbene3) return null;
  const k = product.kategorieEbene3.trim().toLowerCase();
  if (k.startsWith("solitaire")) return "Solitaire";
  if (k.startsWith("memoire")) return "Memoire";
  if (k === "pavé" || k === "pave") return "Pavé";
  if (k.startsWith("farbstein")) return "Farbstein";
  if (k === "flex") return "Flexring";
  return null;
}

export function deriveFilterFacets(product: FacetInput) {
  const ringType = ringTypeLabel(product);
  return {
    ringType,
    engagementRing: ringType === "Solitaire",
    metalColors: metalColors(product.hauptmaterial),
    alloy: alloyLabel(product.legierung),
    cutShape: cutShapeLabel(product.diamantSchliffguete),
    caratGroup: caratGroup(product.caratur),
  };
}

// Metafeld-Definitionen im Shopify-Namensraum "marinell" (siehe ensureFilterMetafieldDefinitions).
export const FILTER_METAFIELDS = [
  { key: "metal_colors", name: "Metallfarbe", type: "list.single_line_text_field" },
  { key: "alloy", name: "Legierung", type: "single_line_text_field" },
  { key: "stone_cut", name: "Schliffform", type: "single_line_text_field" },
  { key: "carat_group", name: "Karatgruppe", type: "single_line_text_field" },
  { key: "ring_type", name: "Ringtyp", type: "single_line_text_field" },
] as const;
