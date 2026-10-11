// Bewusst ohne "server-only": Vokabeln und Prüfregeln werden von Server Actions UND vom
// Editor-Formular (Client) genutzt, damit beide exakt dieselben Auswahllisten und Pflichtfelder
// kennen.
//
// Leitlinie (siehe Konzept): Alle Fakten kommen von Menschen aus dem Editor, die KI bekommt sie nur
// zum Formulieren und darf nichts ergänzen. Fehlt ein Pflichtfeld, kann das Produkt gespeichert
// werden (Entwurf), bekommt aber den Status "Daten unvollständig" und darf nicht weiter in die
// Pipeline.
import type { sourceProducts, StoneOrigin } from "@/db/schema";

type SourceProduct = typeof sourceProducts.$inferSelect;

// hauptkategorie/kategorieEbene1 verwenden bewusst dieselben Werte wie die DG-Datei, weil Filter,
// Bildpipeline (bodyPartMapping, Compositing-Kalibrierung) und Textgenerierung darauf aufbauen.
export const PRODUCT_TYPES = {
  ring: { label: "Ring", hauptkategorie: "Ring", kategorieEbene1: "Ringe" },
  ohrschmuck: { label: "Ohrschmuck", hauptkategorie: "Ohrschmuck", kategorieEbene1: "Ohrschmuck" },
  collier: { label: "Collier", hauptkategorie: "Colliers", kategorieEbene1: "Halsschmuck" },
  anhaenger: { label: "Anhänger", hauptkategorie: "Anhänger", kategorieEbene1: "Halsschmuck" },
  armband: { label: "Armband", hauptkategorie: "Armbänder", kategorieEbene1: "Armschmuck" },
  armreif: { label: "Armreif", hauptkategorie: "Armreifen", kategorieEbene1: "Armschmuck" },
} as const;
export type ProductTypeKey = keyof typeof PRODUCT_TYPES;

export const STONE_ORIGIN_LABELS: Record<StoneOrigin, string> = {
  lab_grown: "Labordiamant",
  natural: "Natürlicher Diamant",
};

// Werte entsprechen den DG-Hauptmaterialien (Filter im Tool), Anzeige in Klammern.
export const GOLD_COLORS = [
  { value: "Weißgold", label: "Weißgold" },
  { value: "Gelbgold", label: "Gelbgold" },
  { value: "Rotgold", label: "Roségold (Rotgold)" },
] as const;

export const FINENESS_OPTIONS = [
  { value: 333, label: "333 (8 Karat)", legierung: "8kt" },
  { value: 585, label: "585 (14 Karat)", legierung: "14kt" },
  { value: 750, label: "750 (18 Karat)", legierung: "18kt" },
] as const;

export const CUT_SHAPES = ["Rund", "Oval", "Emerald", "Pear", "Cushion", "Marquise", "Princess", "Radiant", "Herz"];
export const CUT_QUALITIES = ["Excellent", "Very Good", "Good"];
export const DIAMOND_COLORS = ["D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
export const CLARITIES = ["FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3"];
export const CERT_INSTITUTES = ["GIA", "IGI", "HRD", "Andere"];

// Interne SKU für eigene Produkte - landet in modellErweitert (unique), das auch als Shopify-SKU und
// im Mapping als Schlüssel dient. Prefix "EP" = Eigenes Produkt, klar unterscheidbar von DG-Nummern.
export const CUSTOM_SKU_PREFIX = "EP-";

// Alle Felder als Strings, so wie sie aus dem Formular kommen. Aufbereitung in toDbValues().
export type CustomProductForm = {
  name: string;
  description: string;
  productType: ProductTypeKey | "";
  stoneOrigin: StoneOrigin | "";
  goldColor: string;
  fineness: string;
  rhodiniert: "" | "yes" | "no";
  weightG: string;
  cutShape: string;
  cutQuality: string;
  mainStoneCt: string;
  totalCt: string;
  stoneCount: string;
  diamondColor: string;
  clarity: string;
  certInstitute: string;
  certNumber: string;
  designFamilyId: string;
  ringSizes: string;
  uvp: string;
  purchasePrice: string;
  categoryIds: number[];
};

export const EMPTY_FORM: CustomProductForm = {
  name: "",
  description: "",
  productType: "",
  stoneOrigin: "",
  goldColor: "",
  fineness: "",
  rhodiniert: "",
  weightG: "",
  cutShape: "",
  cutQuality: "",
  mainStoneCt: "",
  totalCt: "",
  stoneCount: "",
  diamondColor: "",
  clarity: "",
  certInstitute: "",
  certNumber: "",
  designFamilyId: "",
  ringSizes: "",
  uvp: "",
  purchasePrice: "",
  categoryIds: [],
};

function parseNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : Number.NaN;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// "50, 52 54" -> ["50","52","54"], ohne Duplikate, Reihenfolge numerisch.
export function parseRingSizes(value: string): string[] {
  const parts = value
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return unique.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

export type ParsedCustomProduct = {
  values: Partial<typeof sourceProducts.$inferInsert>;
  categoryIds: number[];
  // Feldfehler, die ein Speichern verhindern (falsches Format, widersprüchliche Angaben).
  errors: Record<string, string>;
};

// Übersetzt das Formular in DB-Spalten. Pflichtfelder werden hier NICHT erzwungen (Entwurf darf
// unvollständig sein) - nur Format und Widersprüche, siehe getMissingFields() für Vollständigkeit.
export function parseCustomProductForm(form: CustomProductForm): ParsedCustomProduct {
  const errors: Record<string, string> = {};

  const numberField = (key: keyof CustomProductForm, label: string, opts?: { min?: number; integer?: boolean }) => {
    const raw = form[key];
    const num = typeof raw === "string" ? parseNumber(raw) : null;
    if (num !== null && Number.isNaN(num)) {
      errors[key] = `${label}: keine gültige Zahl.`;
      return null;
    }
    if (num !== null && opts?.min !== undefined && num < opts.min) {
      errors[key] = `${label}: muss mindestens ${opts.min} sein.`;
      return null;
    }
    if (num !== null && opts?.integer && !Number.isInteger(num)) {
      errors[key] = `${label}: muss eine ganze Zahl sein.`;
      return null;
    }
    return num;
  };

  const mainStoneCt = numberField("mainStoneCt", "Hauptstein (ct)", { min: 0.001 });
  const totalCt = numberField("totalCt", "Gesamtgewicht (ct)", { min: 0.001 });
  const stoneCount = numberField("stoneCount", "Anzahl Steine", { min: 1, integer: true });
  const uvp = numberField("uvp", "Verkaufspreis", { min: 0.01 });
  const purchasePrice = numberField("purchasePrice", "Einkaufspreis", { min: 0 });
  const weightG = numberField("weightG", "Schmuckgewicht (g)", { min: 0.01 });

  if (mainStoneCt !== null && totalCt !== null && totalCt < mainStoneCt) {
    errors.totalCt = "Gesamtgewicht darf nicht kleiner sein als das Gewicht des Hauptsteins.";
  }
  if (stoneCount === 1 && mainStoneCt !== null && totalCt !== null && Math.abs(totalCt - mainStoneCt) > 0.0001) {
    errors.totalCt = "Bei nur einem Stein müssen Hauptstein und Gesamtgewicht übereinstimmen.";
  }

  const finenessNum = form.fineness === "" ? null : Number(form.fineness);
  const fineness = FINENESS_OPTIONS.find((f) => f.value === finenessNum) ?? null;
  if (form.fineness !== "" && !fineness) errors.fineness = "Unbekannte Legierung.";

  if (form.goldColor && !GOLD_COLORS.some((g) => g.value === form.goldColor)) {
    errors.goldColor = "Unbekannte Goldfarbe.";
  }

  const certNumber = emptyToNull(form.certNumber);
  const certInstitute = emptyToNull(form.certInstitute);
  if (certNumber && !certInstitute) {
    errors.certInstitute = "Zertifikatsnummer ohne Zertifikatsinstitut.";
  }

  const productType = form.productType ? PRODUCT_TYPES[form.productType] : null;
  if (form.productType && !productType) errors.productType = "Unbekannte Schmuckart.";

  const ringSizes = parseRingSizes(form.ringSizes);
  const badSize = ringSizes.find((s) => !/^\d{2}(\.\d)?$/.test(s));
  if (badSize) errors.ringSizes = `Ungültige Ringgröße "${badSize}" (erwartet z.B. 52 oder 52.5).`;

  const values: ParsedCustomProduct["values"] = {
    kurzBezeichnungDe: emptyToNull(form.name),
    langBezeichnungDe: emptyToNull(form.description),
    hauptkategorie: productType?.hauptkategorie ?? null,
    kategorieEbene1: productType?.kategorieEbene1 ?? null,
    stoneOrigin: form.stoneOrigin || null,
    hauptmaterial: emptyToNull(form.goldColor),
    fineness: fineness?.value ?? null,
    legierung: fineness?.legierung ?? null,
    legierungsgewicht: weightG,
    rhodiniert: form.rhodiniert === "" ? null : form.rhodiniert === "yes",
    cutShape: emptyToNull(form.cutShape),
    diamantSchliffguete: emptyToNull(form.cutQuality),
    mainStoneCt,
    caratur: totalCt,
    anzahlSteine: stoneCount,
    diamantFarbe: emptyToNull(form.diamondColor),
    diamantReinheit: emptyToNull(form.clarity),
    certInstitute,
    certNumber,
    designFamilyId: emptyToNull(form.designFamilyId),
    ringSizes: ringSizes.length > 0 ? ringSizes : null,
    uvp,
    uvpWaehrung: "EUR",
    einkaufspreis: purchasePrice,
    einkaufspreisWaehrung: purchasePrice === null ? null : "EUR",
  };

  return { values, categoryIds: Array.from(new Set(form.categoryIds)), errors };
}

// Gegenrichtung für das Bearbeiten: DB-Zeile -> Formularwerte.
export function formFromProduct(product: SourceProduct, categoryIds: number[]): CustomProductForm {
  const typeKey =
    (Object.entries(PRODUCT_TYPES).find(([, t]) => t.hauptkategorie === product.hauptkategorie)?.[0] as
      | ProductTypeKey
      | undefined) ?? "";
  const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

  return {
    name: product.kurzBezeichnungDe ?? "",
    description: product.langBezeichnungDe ?? "",
    productType: typeKey,
    stoneOrigin: product.stoneOrigin ?? "",
    goldColor: product.hauptmaterial ?? "",
    fineness: str(product.fineness),
    rhodiniert: product.rhodiniert === null ? "" : product.rhodiniert ? "yes" : "no",
    weightG: str(product.legierungsgewicht),
    cutShape: product.cutShape ?? "",
    cutQuality: product.diamantSchliffguete ?? "",
    mainStoneCt: str(product.mainStoneCt),
    totalCt: str(product.caratur),
    stoneCount: str(product.anzahlSteine),
    diamondColor: product.diamantFarbe ?? "",
    clarity: product.diamantReinheit ?? "",
    certInstitute: product.certInstitute ?? "",
    certNumber: product.certNumber ?? "",
    designFamilyId: product.designFamilyId ?? "",
    ringSizes: (product.ringSizes ?? []).join(", "),
    uvp: str(product.uvp),
    purchasePrice: str(product.einkaufspreis),
    categoryIds,
  };
}

export const FIELD_LABELS: Record<string, string> = {
  name: "Produktname",
  productType: "Schmuckart",
  stoneOrigin: "Labor-/Naturdiamant",
  goldColor: "Goldfarbe",
  fineness: "Goldlegierung",
  rhodiniert: "Rhodiniert (ja/nein)",
  cutShape: "Schliffform",
  cutQuality: "Schliffqualität",
  mainStoneCt: "Gewicht Hauptstein",
  totalCt: "Gesamtgewicht Steine",
  stoneCount: "Anzahl Steine",
  diamondColor: "Diamantfarbe",
  clarity: "Reinheit",
  uvp: "Verkaufspreis",
  ringSizes: "Ringgrößen",
  images: "Mindestens ein Bild",
  categories: "Mindestens eine Kategorie",
};

// Vollständigkeitsprüfung auf Basis gespeicherter Daten - wird sowohl beim Speichern (Status
// "Daten unvollständig" setzen/aufheben) als auch als Sperre vor Pipeline/Freigabe verwendet.
export function getMissingFields(
  product: Pick<
    SourceProduct,
    | "kurzBezeichnungDe"
    | "hauptkategorie"
    | "stoneOrigin"
    | "hauptmaterial"
    | "fineness"
    | "rhodiniert"
    | "cutShape"
    | "diamantSchliffguete"
    | "mainStoneCt"
    | "caratur"
    | "anzahlSteine"
    | "diamantFarbe"
    | "diamantReinheit"
    | "uvp"
    | "ringSizes"
  >,
  imageCount: number,
  categoryCount: number,
): string[] {
  const missing: string[] = [];
  const blank = (v: unknown) => v === null || v === undefined || v === "";

  if (blank(product.kurzBezeichnungDe)) missing.push("name");
  if (blank(product.hauptkategorie)) missing.push("productType");
  if (blank(product.stoneOrigin)) missing.push("stoneOrigin");
  if (blank(product.hauptmaterial)) missing.push("goldColor");
  if (blank(product.fineness)) missing.push("fineness");
  if (product.rhodiniert === null || product.rhodiniert === undefined) missing.push("rhodiniert");
  if (blank(product.cutShape)) missing.push("cutShape");
  if (blank(product.diamantSchliffguete)) missing.push("cutQuality");
  if (blank(product.mainStoneCt)) missing.push("mainStoneCt");
  if (blank(product.caratur)) missing.push("totalCt");
  if (blank(product.anzahlSteine)) missing.push("stoneCount");
  if (blank(product.diamantFarbe)) missing.push("diamondColor");
  if (blank(product.diamantReinheit)) missing.push("clarity");
  if (blank(product.uvp)) missing.push("uvp");
  if (product.hauptkategorie === "Ring" && (product.ringSizes?.length ?? 0) === 0) missing.push("ringSizes");
  if (imageCount === 0) missing.push("images");
  if (categoryCount === 0) missing.push("categories");

  return missing;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Vorschlag für die Design-Family-ID: gleicher Produktname + gleiche Schmuckart ergibt dieselbe ID,
// also automatisch dieselbe Familie. Wer Ausführungen anders benennt, ändert die ID im Editor.
export function suggestDesignFamilyId(name: string, productType: string): string {
  const slug = slugify(name);
  return slug && productType ? `${slug}-${productType}` : "";
}

export type FamilyMember = {
  id: number;
  familyId: string;
  name: string;
  detail: string;
};
