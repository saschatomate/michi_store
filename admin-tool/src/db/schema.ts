import { pgTable, text, integer, doublePrecision, jsonb, serial, timestamp, index, boolean } from "drizzle-orm/pg-core";

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

    // Welcher Import-Lauf diesen Artikel zuerst angelegt hat (nur bei INSERT gesetzt, bleibt bei
    // Re-Import/Update unangetastet - siehe PRESERVE_ON_CONFLICT in csv-import.ts). NULL bei
    // Artikeln, die vor Einführung dieses Felds importiert/eingespielt wurden.
    firstSeenImportRunId: integer("first_seen_import_run_id").references(() => importRuns.id),

    // Täglicher Diamond-Group-Sync (items_dg_stock.csv / items_dg_40.csv): newArrivalAt ist gesetzt,
    // solange die SKU in der aktuellen 40er-Datei auftaucht (verschwindet automatisch, sobald sie dort
    // nicht mehr vorkommt - siehe ftp-sync.ts). missingFromStockAt ist gesetzt, wenn die SKU im
    // letzten vollständigen Stock-Import nicht mehr enthalten war (nicht-destruktiv, kein Löschen -
    // heilt selbst, falls der Artikel wieder auftaucht).
    newArrivalAt: timestamp("new_arrival_at", { withTimezone: true }),
    missingFromStockAt: timestamp("missing_from_stock_at", { withTimezone: true }),

    // KI-generierte Texte (Komponente B, Teil 1) - nur aus strukturierten Feldern generiert,
    // nie aus langBezeichnungDe, um Faktenfehler bei Diamant-/Farbstein-Details zu vermeiden
    genProductNameDe: text("gen_product_name_de"),
    genShortDescDe: text("gen_short_desc_de"),
    genLongDescDe: text("gen_long_desc_de"),
    genShortDescEn: text("gen_short_desc_en"),
    genLongDescEn: text("gen_long_desc_en"),
    genSeoTitle: text("gen_seo_title"),
    genSeoDescription: text("gen_seo_description"),
    contentGeneratedAt: timestamp("content_generated_at", { withTimezone: true }),
    contentApprovedAt: timestamp("content_approved_at", { withTimezone: true }),
    contentGenerationError: text("content_generation_error"),

    // KI-Bildgenerierung (Komponente B, Teil 2) - manueller Prompt-Override pro Produkt, falls der
    // automatisch gebaute Prompt korrigiert werden muss (z.B. Innen-/Außenseite bei Armbändern)
    imagePromptOverride: text("image_prompt_override"),

    // Fest zugewiesenes MARINELL-Model (sophia|claire|jen|amara, siehe image-facts.ts) - einmalig
    // beim ersten Generieren berechnet und danach dauerhaft beibehalten, damit dasselbe Produkt bei
    // jeder Neu-Generierung garantiert dasselbe Model zeigt, auch wenn sich die Zuordnungsregel oder
    // Kategoriedaten später ändern.
    assignedModelKey: text("assigned_model_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("status_idx").on(table.status),
    index("kategorie_ebene1_idx").on(table.kategorieEbene1),
    index("hauptmaterial_idx").on(table.hauptmaterial),
    index("bestand_idx").on(table.bestand),
    index("first_seen_import_run_idx").on(table.firstSeenImportRunId),
    index("new_arrival_at_idx").on(table.newArrivalAt),
    index("missing_from_stock_at_idx").on(table.missingFromStockAt),
  ],
);

export const IMAGE_STATUS_VALUES = ["pending_review", "approved", "rejected"] as const;
export type GeneratedImageStatus = (typeof IMAGE_STATUS_VALUES)[number];

// KI-generierte Produktbilder (Komponente B, Teil 2) - Referenzfoto (freistellerUrl) wird als
// echtes Bild an die Bild-API übergeben, nie frei generiert, um das Aussehen des Stücks nicht zu
// erfinden. 3 Varianten pro Lauf (unterschiedliche Hand-/Hautton-Presets), je eigener Freigabe-Status.
export const productGeneratedImages = pgTable(
  "product_generated_images",
  {
    id: serial("id").primaryKey(),
    sourceProductId: integer("source_product_id")
      .notNull()
      .references(() => sourceProducts.id),
    variantIndex: integer("variant_index").notNull(),
    handPreset: text("hand_preset").notNull(),
    imageUrl: text("image_url"),
    storagePath: text("storage_path"),
    status: text("status").$type<GeneratedImageStatus>().notNull().default("pending_review"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    generationError: text("generation_error"),
    // true nur, wenn der Compositing-Weg (image-compositing.ts) den Anhänger ohne Kette ausgeliefert
    // hat - entweder mangels Ketten-Kalibrierung/API-Key oder weil alle MAX_CHAIN_ATTEMPTS-Versuche
    // von verifyPendantIntact() verworfen wurden (siehe compositeJewelryVariant()). Sieht in der DB
    // sonst wie ein normaler Erfolg aus (kein generationError), daher dieses eigene Flag statt den
    // Fall über den Prompt-Text zu erraten. Für den klassischen Weg (generateProductImageVariant())
    // immer false - dort gibt es keinen separaten Kettenschritt, der fehlschlagen könnte.
    chainMissing: boolean("chain_missing").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("product_generated_images_product_idx").on(table.sourceProductId)],
);

export const API_USAGE_PROVIDER_VALUES = ["anthropic", "openai"] as const;
export type ApiUsageProvider = (typeof API_USAGE_PROVIDER_VALUES)[number];

export const API_USAGE_PURPOSE_VALUES = ["text_generation", "image_generation"] as const;
export type ApiUsagePurpose = (typeof API_USAGE_PURPOSE_VALUES)[number];

// Kosten-Tracking für die Budget-Anzeige im Admin: ein Eintrag pro tatsächlichem API-Aufruf an
// Claude (Textgenerierung, text-generation.ts) oder OpenAI (Bildgenerierung, image-generation.ts),
// berechnet aus der von der jeweiligen API zurückgegebenen echten Token-Nutzung (nicht geschätzt,
// siehe lib/cost-tracking.ts). Bewusst append-only: wird nie verändert oder gelöscht, auch wenn
// eine Bildvariante später neu generiert wird - das Geld für den vorherigen Aufruf wurde bereits
// ausgegeben und muss im Gesamtverbrauch bleiben.
export const apiUsageEvents = pgTable(
  "api_usage_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").$type<ApiUsageProvider>().notNull(),
    purpose: text("purpose").$type<ApiUsagePurpose>().notNull(),
    sourceProductId: integer("source_product_id").references(() => sourceProducts.id),
    // Bei Bildgenerierung: welche der 3 Varianten (0-2, siehe POSE_VARIANTS) diesen Aufruf
    // ausgelöst hat - erlaubt es, die zuletzt für einen Slot gezahlten Kosten anzuzeigen.
    variantIndex: integer("variant_index"),
    model: text("model").notNull(),
    // Rohe Usage-Antwort der jeweiligen API - Audit-Trail und Basis für eine Neuberechnung, falls
    // sich die Preistabelle in cost-tracking.ts später ändert.
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    costUsd: doublePrecision("cost_usd").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_usage_events_source_product_idx").on(table.sourceProductId),
    index("api_usage_events_created_at_idx").on(table.createdAt),
  ],
);

// Einzige Einstellung bisher: das insgesamt verfügbare Budget (USD) für Claude- und
// OpenAI-Aufrufe, manuell in der Admin-Oberfläche gepflegt (weder Anthropic noch OpenAI bieten für
// normale API-Keys einen Guthaben-Abfrage-Endpoint). Immer genau eine Zeile mit id=1 (Singleton,
// siehe budget-actions.ts).
export const budgetSettings = pgTable("budget_settings", {
  id: serial("id").primaryKey(),
  totalBudgetUsd: doublePrecision("total_budget_usd").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  // "manual" (Upload über /import) | "ftp_auto" (täglicher Diamond-Group-Sync, siehe ftp-sync.ts)
  source: text("source").notNull().default("manual"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsUpdated: integer("rows_updated").notNull().default(0),
  rowsError: integer("rows_error").notNull().default(0),
  status: text("status").notNull().default("running"), // running | success | failed
  errorMessage: text("error_message"),
});
