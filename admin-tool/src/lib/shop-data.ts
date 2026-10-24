// Bewusst ohne "server-only": wird von Server-Code (Shopify-Übertragung) und vom Client (Vorschau im
// Shop-Daten-Editor) gemeinsam genutzt.
//
// Alles, was im Shop erscheint, entsteht deterministisch aus den Produktfakten - ohne KI-Text:
// Titel, Preis und Beschreibung (Intro-Text der Kategorie + Faktenliste). Jedes dieser drei Felder
// lässt sich pro Produkt von Hand überschreiben (title_override / price_override / description_override);
// leer = wieder automatisch.
import type { sourceProducts } from "@/db/schema";
import { STONE_ORIGIN_LABELS } from "@/lib/custom-product";

export type ShopDataProduct = Pick<
  typeof sourceProducts.$inferSelect,
  | "origin"
  | "modellErweitert"
  | "kurzBezeichnungDe"
  | "genProductNameDe"
  | "uvp"
  | "titleOverride"
  | "priceOverride"
  | "descriptionOverride"
  | "hauptmaterial"
  | "legierung"
  | "fineness"
  | "rhodiniert"
  | "legierungsgewicht"
  | "stoneOrigin"
  | "caratur"
  | "mainStoneCt"
  | "anzahlSteine"
  | "cutShape"
  | "diamantSchliffguete"
  | "diamantFarbe"
  | "diamantReinheit"
  | "caraturFarbstein"
  | "anzahlSteineFarbstein"
  | "certInstitute"
  | "certNumber"
  | "giaZertifikatNr"
  | "hoehe"
  | "breite"
  | "durchmesser"
  | "staerke"
  | "produktLaengeCm"
>;

// Automatischer Verkaufspreis: Die DG-UVP ist für den Shop zu hoch, deshalb wird auf den
// vorherigen vollen Hunderter abgerundet (1.490 € -> 1.400 €). Unter 100 € bliebe dabei 0, dort
// wird nur auf volle Euro abgerundet. Eigene Produkte: dort hat der Mensch den Preis selbst
// eingegeben, er bleibt unverändert.
export function autoShopPrice(p: Pick<ShopDataProduct, "origin" | "uvp">): number | null {
  if (p.uvp === null || p.uvp === undefined) return null;
  if (p.origin === "custom") return p.uvp;
  const hundreds = Math.floor(p.uvp / 100) * 100;
  return hundreds >= 100 ? hundreds : Math.floor(p.uvp);
}

export function shopPrice(p: ShopDataProduct): number | null {
  return p.priceOverride ?? autoShopPrice(p);
}

export function autoShopTitle(p: ShopDataProduct): string {
  return p.genProductNameDe || p.kurzBezeichnungDe || p.modellErweitert;
}

export function shopTitle(p: ShopDataProduct): string {
  return p.titleOverride?.trim() || autoShopTitle(p);
}

const nf = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const num = (v: number | null | undefined, unit: string) => (!v || v <= 0 ? null : `${nf.format(v)} ${unit}`);

export function factList(p: ShopDataProduct): { label: string; value: string }[] {
  const material = [p.hauptmaterial, p.fineness ? `${p.fineness}er` : null].filter(Boolean).join(" ");
  const stones = [
    p.mainStoneCt ? `Hauptstein ${nf.format(p.mainStoneCt)} ct` : null,
    p.caratur ? `Gesamtgewicht ${nf.format(p.caratur)} ct` : null,
    p.anzahlSteine ? `${p.anzahlSteine} ${p.anzahlSteine === 1 ? "Stein" : "Steine"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const colored = [
    p.caraturFarbstein ? `${nf.format(p.caraturFarbstein)} ct` : null,
    p.anzahlSteineFarbstein ? `${p.anzahlSteineFarbstein} ${p.anzahlSteineFarbstein === 1 ? "Stein" : "Steine"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const cert = [p.certInstitute, p.certNumber ?? p.giaZertifikatNr].filter(Boolean).join(" ");

  const facts: [string, string | null][] = [
    ["Material", material || null],
    ["Legierung", p.legierung ?? null],
    ["Rhodiniert", p.rhodiniert === null || p.rhodiniert === undefined ? null : p.rhodiniert ? "Ja" : "Nein"],
    ["Gewicht", num(p.legierungsgewicht, "g")],
    ["Steinart", p.stoneOrigin ? STONE_ORIGIN_LABELS[p.stoneOrigin] : null],
    ["Diamanten", stones || null],
    ["Schliff", [p.cutShape, p.diamantSchliffguete].filter(Boolean).join(", ") || null],
    ["Farbe", p.diamantFarbe ?? null],
    ["Reinheit", p.diamantReinheit ?? null],
    ["Farbsteine", colored || null],
    ["Zertifikat", cert || null],
    ["Höhe", num(p.hoehe, "mm")],
    ["Breite", num(p.breite, "mm")],
    ["Durchmesser", num(p.durchmesser, "mm")],
    ["Stärke", num(p.staerke, "mm")],
    ["Länge", num(p.produktLaengeCm, "cm")],
    ["Artikelnummer", p.modellErweitert.trim()],
  ];
  return facts.filter((f): f is [string, string] => Boolean(f[1])).map(([label, value]) => ({ label, value }));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function htmlFromPlainText(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// Automatische Beschreibung als Klartext (Vorschau und Ausgangspunkt für die manuelle Bearbeitung).
export function autoDescriptionPlain(p: ShopDataProduct, intro: string | null): string {
  const facts = factList(p).map((f) => `${f.label}: ${f.value}`).join("\n");
  return [intro?.trim(), facts].filter(Boolean).join("\n\n");
}

// Beschreibung für Shopify: Überschreibung (Klartext) oder Intro + Faktenliste als <ul>.
export function descriptionHtml(p: ShopDataProduct, intro: string | null): string {
  if (p.descriptionOverride?.trim()) return htmlFromPlainText(p.descriptionOverride);
  const list = factList(p);
  return [
    intro?.trim() ? htmlFromPlainText(intro) : "",
    list.length > 0
      ? `<ul>\n${list.map((f) => `<li><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}</li>`).join("\n")}\n</ul>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function descriptionPlain(p: ShopDataProduct, intro: string | null): string {
  return p.descriptionOverride?.trim() || autoDescriptionPlain(p, intro);
}
