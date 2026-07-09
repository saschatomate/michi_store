import { pgTable, text, integer, doublePrecision, jsonb, serial, timestamp, index } from "drizzle-orm/pg-core";

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

export const sourceProducts = pgTable(
  "source_products",
  {
    id: serial("id").primaryKey(),

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
    legierungsgewicht: doublePrecision("legierungsgewicht"),

    // Diamant (Übersicht)
    caratur: doublePrecision("caratur"),
    anzahlSteine: integer("anzahl_steine"),
    diamantSchliffguete: text("diamant_schliffguete"),
    diamantFarbe: text("diamant_farbe"),
    diamantReinheit: text("diamant_reinheit"),

    // Farbstein (Übersicht)
    caraturFarbstein: doublePrecision("caratur_farbstein"),
    anzahlSteineFarbstein: integer("anzahl_steine_farbstein"),

    // Preise
    einkaufspreis: doublePrecision("einkaufspreis"),
    einkaufspreisWaehrung: text("einkaufspreis_waehrung"),
    uvp: doublePrecision("uvp"),
    uvpWaehrung: text("uvp_waehrung"),

    // Bestand & Maße
    bestand: integer("bestand"),
    ringgroesse: text("ringgroesse"),
    hoehe: doublePrecision("hoehe"),
    breite: doublePrecision("breite"),
    durchmesser: doublePrecision("durchmesser"),
    staerke: doublePrecision("staerke"),
    produktLaengeCm: doublePrecision("produkt_laenge_cm"),

    // Bilder
    freistellerUrl: text("freisteller_url"),
    modelbildUrl: text("modelbild_url"),
    bildUrls: jsonb("bild_urls").$type<string[]>(),

    // Zertifikate
    beschaffenheit: text("beschaffenheit"),
    giaZertifikatNr: text("gia_zertifikat_nr"),

    // Sonstiges
    liefertermin: text("liefertermin"),
    angelegt: text("angelegt"),
    geaendert: text("geaendert"),
    aehnlicheArtikel: text("aehnliche_artikel"),

    // Vollständige Original-Zeile (alle 149 Felder, inkl. Diamant1-8_*/Farbstein1-8_*)
    rawJson: jsonb("raw_json").$type<Record<string, string>>(),

    // Pipeline-Status & Shopify-Mapping (Leitplanke #3)
    status: text("status").$type<ProductStatus>().notNull().default("neu"),
    shopifyProductId: text("shopify_product_id"),
    sentToPipelineAt: timestamp("sent_to_pipeline_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("status_idx").on(table.status),
    index("kategorie_ebene1_idx").on(table.kategorieEbene1),
    index("hauptmaterial_idx").on(table.hauptmaterial),
    index("bestand_idx").on(table.bestand),
  ],
);

export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsUpdated: integer("rows_updated").notNull().default(0),
  rowsError: integer("rows_error").notNull().default(0),
  status: text("status").notNull().default("running"), // running | success | failed
  errorMessage: text("error_message"),
});
