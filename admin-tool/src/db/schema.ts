import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const STATUS_VALUES = [
  "neu",
  "ausgewaehlt",
  "in_pipeline",
  "review",
  "veroeffentlicht",
  "abgelehnt",
  "archiviert",
] as const;

export type ProductStatus = (typeof STATUS_VALUES)[number];

export const sourceProducts = sqliteTable(
  "source_products",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),

  // Identifikation / Mapping
  modellErweitert: text("modell_erweitert").notNull().unique(),
  modell: text("modell"),
  lieferantenArtikelNr: text("lieferanten_artikel_nr"),
  eanCode: text("ean_code"),

  // Bezeichnungen
  kurzBezeichnungDe: text("kurz_bezeichnung_de"),
  langBezeichnungDe: text("lang_bezeichnung_de"),
  kurzBezeichnungEn: text("kurz_bezeichnung_en"),
  langBezeichnungEn: text("lang_bezeichnung_en"),

  // Kategorisierung
  hauptkategorie: text("hauptkategorie"),
  kategorieEbene1: text("kategorie_ebene1"),
  kategorieEbene2: text("kategorie_ebene2"),
  kategorieEbene3: text("kategorie_ebene3"),

  // Material
  hauptmaterial: text("hauptmaterial"),
  legierung: text("legierung"),
  legierungsgewicht: real("legierungsgewicht"),

  // Diamant (Übersicht)
  caratur: real("caratur"),
  anzahlSteine: integer("anzahl_steine"),
  diamantSchliffguete: text("diamant_schliffguete"),
  diamantFarbe: text("diamant_farbe"),
  diamantReinheit: text("diamant_reinheit"),

  // Farbstein (Übersicht)
  caraturFarbstein: real("caratur_farbstein"),
  anzahlSteineFarbstein: integer("anzahl_steine_farbstein"),

  // Preise
  einkaufspreis: real("einkaufspreis"),
  einkaufspreisWaehrung: text("einkaufspreis_waehrung"),
  uvp: real("uvp"),
  uvpWaehrung: text("uvp_waehrung"),

  // Bestand & Maße
  bestand: integer("bestand"),
  ringgroesse: text("ringgroesse"),
  hoehe: real("hoehe"),
  breite: real("breite"),
  durchmesser: real("durchmesser"),
  staerke: real("staerke"),
  produktLaengeCm: real("produkt_laenge_cm"),

  // Bilder
  freistellerUrl: text("freisteller_url"),
  modelbildUrl: text("modelbild_url"),
  bildUrls: text("bild_urls", { mode: "json" }).$type<string[]>(),

  // Zertifikate
  beschaffenheit: text("beschaffenheit"),
  giaZertifikatNr: text("gia_zertifikat_nr"),

  // Sonstiges
  liefertermin: text("liefertermin"),
  angelegt: text("angelegt"),
  geaendert: text("geaendert"),
  aehnlicheArtikel: text("aehnliche_artikel"),

  // Vollständige Original-Zeile (alle 149 Felder, inkl. Diamant1-8_*/Farbstein1-8_*)
  rawJson: text("raw_json", { mode: "json" }).$type<Record<string, string>>(),

  // Pipeline-Status & Shopify-Mapping (Leitplanke #3)
  status: text("status").$type<ProductStatus>().notNull().default("neu"),
  shopifyProductId: text("shopify_product_id"),
  sentToPipelineAt: text("sent_to_pipeline_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("status_idx").on(table.status),
    index("kategorie_ebene1_idx").on(table.kategorieEbene1),
    index("hauptmaterial_idx").on(table.hauptmaterial),
    index("bestand_idx").on(table.bestand),
  ],
);

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  finishedAt: text("finished_at"),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsUpdated: integer("rows_updated").notNull().default(0),
  rowsError: integer("rows_error").notNull().default(0),
  status: text("status").notNull().default("running"), // running | success | failed
  errorMessage: text("error_message"),
});
