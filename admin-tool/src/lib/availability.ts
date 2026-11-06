// Bewusst ohne "server-only": reine Berechnung, wird von Server-Seiten UND später vom Shopify-
// Mapping genutzt. Die Regeln (Lieferzeiten) kommen aus der Tabelle availability_rules und werden
// hereingereicht - hier steht keine Lieferzeit im Code.
//
// Konzept: Es gibt keinen Status "ausverkauft". Bestand 0 heißt "Anfertigung auf Bestellung" mit
// der längeren Lieferzeit, verkauft wird weiter. Nur der manuelle Schalter "discontinued" nimmt ein
// Produkt aus dem Verkauf, weil DG kein eigenes "ausgelistet"-Signal liefert.
import type { sourceProducts } from "@/db/schema";

type SourceProduct = typeof sourceProducts.$inferSelect;

export type AvailabilityRule = { unit: "days" | "weeks" | "workdays"; min: number; max: number };
export type AvailabilityRules = Record<"in_stock" | "lab_grown" | "natural" | "shipping", AvailabilityRule>;

export const DEFAULT_RULES: AvailabilityRules = {
  in_stock: { unit: "days", min: 5, max: 7 },
  lab_grown: { unit: "weeks", min: 3, max: 4 },
  natural: { unit: "weeks", min: 5, max: 6 },
  shipping: { unit: "workdays", min: 1, max: 3 },
};

// Größenregel (angepasst 2026-11-02): im Shop gibt es alle ganzen Größen von 46 bis 60. Aus dem
// Lager-Einzelstück (Basisgröße, z.B. 48) lassen sich die Größen von 2 kleiner bis 2 größer schnell
// liefern (46-50, Lieferzeit "auf Lager"); alle übrigen Größen (51-60) werden auf Auftrag gefertigt.
export const RING_SIZE_MIN = 46;
export const RING_SIZE_MAX = 60;
export const RING_STOCK_DOWN = 2;
export const RING_STOCK_UP = 2;

export type VariantAvailability = {
  size: string;
  mode: "in_stock" | "made_to_order";
  label: string;
  // true für genau die Größe des Lager-Einzelstücks - nur dort liegt der physische Bestand.
  isBaseSize?: boolean;
};

export type ProductAvailability = {
  sellable: boolean;
  mode: "in_stock" | "made_to_order" | "discontinued";
  // Kurztext fürs Admin-UI und später für Shopify (Metafield/Produktseite).
  label: string;
  rule: AvailabilityRule | null;
  // Lieferzeit für Anfertigung (je nach Steinherkunft) - auch bei Lagerware gebraucht, weil andere
  // Ringgrößen dann trotzdem angefertigt werden.
  madeToOrderRule: AvailabilityRule | null;
  // DG liefert keine Steinherkunft - dann wird vorsichtig mit der längeren Natur-Lieferzeit
  // gerechnet und das hier sichtbar gemacht.
  originAssumed: boolean;
  warnings: string[];
  variants: VariantAvailability[];
};

function unitLabel(rule: AvailabilityRule): string {
  const unit = rule.unit === "days" ? "Tagen" : rule.unit === "weeks" ? "Wochen" : "Werktagen";
  return rule.min === rule.max ? `${rule.min} ${unit}` : `${rule.min}–${rule.max} ${unit}`;
}

// "1–3 Werktage" (Nominativ, für Sätze wie "beträgt ... etwa 1–3 Werktage").
function plainUnitLabel(rule: AvailabilityRule): string {
  const unit = rule.unit === "days" ? "Tage" : rule.unit === "weeks" ? "Wochen" : "Werktage";
  return `${rule.min}–${rule.max} ${unit}`;
}

export function shippingLabel(rules: AvailabilityRules): string {
  return `Versand innerhalb Deutschlands: etwa ${plainUnitLabel(rules.shipping)}`;
}

export function parseRingSize(value: string | null | undefined): number | null {
  if (!value) return null;
  const num = Number(value.trim().replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

// Alle verkaufbaren ganzen Größen: 46 bis 60, bei Basisgrößen außerhalb dieses Bereichs entsprechend
// erweitert. Bei Halbgrößen (z.B. 53,5) wird abgerundet.
export function sellableRingSizes(baseSize: number): number[] {
  const base = Math.floor(baseSize);
  const min = Math.min(RING_SIZE_MIN, base - RING_STOCK_DOWN);
  const max = Math.max(RING_SIZE_MAX, base + RING_STOCK_UP);
  const sizes: number[] = [];
  for (let s = min; s <= max; s++) sizes.push(s);
  return sizes;
}

// Größen, die aus dem Lager-Einzelstück schnell lieferbar sind (Basisgröße -2 bis +1).
export function stockRingSizes(baseSize: number): number[] {
  const base = Math.floor(baseSize);
  return sellableRingSizes(baseSize).filter((s) => s >= base - RING_STOCK_DOWN && s <= base + RING_STOCK_UP);
}

const MISSING_WARNING_DAYS = 30;

export function deriveAvailability(
  product: Pick<
    SourceProduct,
    | "origin"
    | "discontinued"
    | "bestand"
    | "stoneOrigin"
    | "hauptkategorie"
    | "ringgroesse"
    | "ringSizes"
    | "missingFromStockAt"
  >,
  rules: AvailabilityRules,
  now: Date = new Date(),
): ProductAvailability {
  if (product.discontinued) {
    return {
      sellable: false,
      mode: "discontinued",
      label: "Nicht mehr lieferbar (ausgelistet)",
      rule: null,
      madeToOrderRule: null,
      originAssumed: false,
      warnings: [],
      variants: [],
    };
  }

  const inStock = (product.bestand ?? 0) > 0;
  const originAssumed = !inStock && product.stoneOrigin === null;
  const madeToOrderRule = product.stoneOrigin === "lab_grown" ? rules.lab_grown : rules.natural;
  const rule = inStock ? rules.in_stock : madeToOrderRule;

  const warnings: string[] = [];
  if (originAssumed) {
    warnings.push("Steinherkunft unbekannt – es wird mit der längeren Lieferzeit für Naturdiamanten gerechnet.");
  }
  if (product.missingFromStockAt && !inStock) {
    const days = Math.floor((now.getTime() - product.missingFromStockAt.getTime()) / 86_400_000);
    if (days >= MISSING_WARNING_DAYS) {
      warnings.push(
        `Seit ${days} Tagen nicht mehr in der Lieferantendatei – bitte prüfen, ob der Artikel ausgelistet ist.`,
      );
    }
  }

  const modeLabel = (mode: "in_stock" | "made_to_order", r: AvailabilityRule) =>
    mode === "in_stock"
      ? `Auf Lager – versandfertig in ${unitLabel(r)}`
      : `Auf Auftrag individuell gefertigt – Lieferzeit ca. ${unitLabel(r)}`;

  // Ringe: eine Variante pro Größe. Eigene Produkte haben eine explizite Größenliste und sind
  // grundsätzlich Anfertigung; DG-Ringe leiten die Größen aus der Basisgröße ab.
  let variants: VariantAvailability[] = [];
  if (product.hauptkategorie === "Ring") {
    if (product.origin === "custom") {
      variants = (product.ringSizes ?? []).map((size) => ({
        size,
        mode: "made_to_order" as const,
        label: modeLabel("made_to_order", madeToOrderRule),
      }));
    } else {
      const base = parseRingSize(product.ringgroesse);
      if (base !== null) {
        const fast = new Set(stockRingSizes(base));
        variants = sellableRingSizes(base).map((size) => {
          const mode = inStock && fast.has(size) ? "in_stock" : "made_to_order";
          return {
            size: String(size),
            mode,
            label: modeLabel(mode, mode === "in_stock" ? rules.in_stock : madeToOrderRule),
            isBaseSize: size === Math.floor(base),
          };
        });
      } else {
        warnings.push("Ringgröße im Katalog nicht lesbar – Größenvarianten können nicht abgeleitet werden.");
      }
    }
  }

  return {
    sellable: true,
    mode: inStock ? "in_stock" : "made_to_order",
    label: modeLabel(inStock ? "in_stock" : "made_to_order", rule),
    rule,
    madeToOrderRule,
    originAssumed,
    warnings,
    variants,
  };
}

// "46–49" bei lückenlosen Größen, sonst "46, 48, 50".
function sizeRange(sizes: string[]): string {
  const nums = sizes.map(Number);
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous && nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : sizes.join(", ");
}

// Kundentext zur Lieferzeit (Produktbeschreibung). Kein Versandzeit-Satz mehr: es steht nur, ob auf
// Lager oder auf Auftrag individuell gefertigt wird, und die Lieferzeit.
export function availabilityParagraph(avail: ProductAvailability, rules: AvailabilityRules): string {
  if (!avail.sellable || !avail.rule || !avail.madeToOrderRule) return "";
  const made = unitLabel(avail.madeToOrderRule);

  const stockSizes = avail.variants.filter((v) => v.mode === "in_stock").map((v) => v.size);
  if (stockSizes.length > 0) {
    return `Auf Lager in den Größen ${sizeRange(stockSizes)}: versandfertig in ${unitLabel(rules.in_stock)}. Alle weiteren Größen werden auf Auftrag individuell für Sie gefertigt, daher beträgt die Lieferzeit ca. ${made}.`;
  }
  if (avail.mode === "in_stock") {
    return `Auf Lager – versandfertig in ${unitLabel(rules.in_stock)}.`;
  }
  return `Dieses Schmuckstück wird auf Auftrag individuell für Sie gefertigt, daher beträgt die Lieferzeit ca. ${made}.`;
}
