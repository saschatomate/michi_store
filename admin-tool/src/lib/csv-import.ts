import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts, importRuns } from "@/db/schema";

type CsvRow = Record<string, string>;

function toNullableString(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toNumber(value: string | undefined): number | null {
  const str = toNullableString(value);
  if (str === null) return null;
  const normalized = str.replace(/\./g, "").replace(",", ".");
  // Werte ohne Komma (reine Ganzzahlen) enthalten evtl. keine Tausenderpunkte -
  // daher zusätzlich den unveränderten String versuchen, falls Normalisierung NaN ergibt.
  const parsed = Number(normalized);
  if (!Number.isNaN(parsed)) return parsed;
  const fallback = Number(str.replace(",", "."));
  return Number.isNaN(fallback) ? null : fallback;
}

function toInt(value: string | undefined): number | null {
  const num = toNumber(value);
  return num === null ? null : Math.round(num);
}

const GIA_REGEX = /GIA\d+/;

function extractGiaNumber(beschaffenheit: string | null): string | null {
  if (!beschaffenheit) return null;
  const match = beschaffenheit.match(GIA_REGEX);
  return match ? match[0] : null;
}

function collectImageUrls(row: CsvRow): string[] {
  const urls: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const url = toNullableString(row[`URL Bild${i}`]);
    if (url) urls.push(url);
  }
  return urls;
}

// Felder, die beim Re-Import NICHT überschrieben werden - ein bereits ausgewählter/
// veröffentlichter Artikel behält seinen Pipeline-Status und die Shopify-Zuordnung,
// nur die Stammdaten aus der Quelle werden aktualisiert. Enthält auch alle Komponente-B-Felder
// (KI-Texte, KI-Bild-Prompt-Override), da diese nicht aus der CSV kommen und sonst bei jedem
// Re-Import auf NULL zurückgesetzt würden (excluded.<spalte> ist NULL für Spalten, die nicht im
// INSERT-Werteobjekt enthalten sind).
const PRESERVE_ON_CONFLICT = new Set([
  "id",
  "modellErweitert",
  "status",
  "shopifyProductId",
  "sentToPipelineAt",
  "createdAt",
  "genProductNameDe",
  "genShortDescDe",
  "genLongDescDe",
  "genShortDescEn",
  "genLongDescEn",
  "genSeoTitle",
  "genSeoDescription",
  "contentGeneratedAt",
  "contentApprovedAt",
  "contentGenerationError",
  "imagePromptOverride",
]);

function conflictUpdateSet() {
  const columns = getTableColumns(sourceProducts);
  const set: Record<string, ReturnType<typeof sql.raw>> = {};
  for (const [key, col] of Object.entries(columns)) {
    if (PRESERVE_ON_CONFLICT.has(key)) continue;
    set[key] = sql.raw(`excluded.${col.name}`);
  }
  return set;
}

type ParsedRow = {
  rowNumber: number;
  modellErweitert: string;
  values: typeof sourceProducts.$inferInsert;
};

function parseRow(row: CsvRow, rowNumber: number): ParsedRow | { rowNumber: number; error: string } {
  const modellErweitert = toNullableString(row["Modell_Erweitert"]);
  if (!modellErweitert) {
    return { rowNumber, error: "Modell_Erweitert fehlt, übersprungen." };
  }

  const beschaffenheit = toNullableString(row["Beschaffenheit"]);

  const values: typeof sourceProducts.$inferInsert = {
    modellErweitert,
    modell: toNullableString(row["Modell"]),
    lieferantenArtikelNr: toNullableString(row["Lieferanten-ArtikelNr"]),
    eanCode: toNullableString(row["EAN-Code"]),

    kurzBezeichnungDe: toNullableString(row["Kurz Artikelbezeichnung"]),
    langBezeichnungDe: toNullableString(row["Lang Artikelbezeichnung"]),
    kurzBezeichnungEn: toNullableString(row["Englisch Kurz Artikelbezeichnung"]),
    langBezeichnungEn: toNullableString(row["Englisch Lang Artikelbezeichnung"]),

    hauptkategorie: toNullableString(row["Hauptkategorie"]),
    kategorieEbene1: toNullableString(row["Kategorie_Ebene1"]),
    kategorieEbene2: toNullableString(row["Kategorie_Ebene2"]),
    kategorieEbene3: toNullableString(row["Kategorie_Ebene3"]),

    hauptmaterial: toNullableString(row["Hauptmaterial"]),
    legierung: toNullableString(row["Legierung"]),
    legierungsgewicht: toNumber(row["Legierungsgewicht"]),

    caratur: toNumber(row["Caratur"]),
    anzahlSteine: toInt(row["Anzahl Steine"]),
    diamantSchliffguete: toNullableString(row["Diamant-Schliffgüte"]),
    diamantFarbe: toNullableString(row["Diamant Farbe"]),
    diamantReinheit: toNullableString(row["Diamant-Reinheit"]),

    caraturFarbstein: toNumber(row["Caratur_Farbstein"]),
    anzahlSteineFarbstein: toInt(row["Anzahl_Steine_Farbstein"]),

    einkaufspreis: toNumber(row["Einkaufspreis"]),
    einkaufspreisWaehrung: toNullableString(row["Währung"]),
    uvp: toNumber(row["UVP"]),
    uvpWaehrung: toNullableString(row["Währung UVP"]),

    bestand: toInt(row["Bestand"]),
    ringgroesse: toNullableString(row["Ringgröße"]),
    hoehe: toNumber(row["Höhe"]),
    breite: toNumber(row["Breite"]),
    durchmesser: toNumber(row["Durchmesser"]),
    staerke: toNumber(row["Stärke"]),
    produktLaengeCm: toNumber(row["Produkt-Länge in cm"]),

    freistellerUrl: toNullableString(row["Freisteller"]),
    modelbildUrl: toNullableString(row["Modelbild"]),
    bildUrls: collectImageUrls(row),

    beschaffenheit,
    giaZertifikatNr: extractGiaNumber(beschaffenheit),

    liefertermin: toNullableString(row["Liefertermin"]),
    angelegt: toNullableString(row["angelegt"]),
    geaendert: toNullableString(row["geändert"]),
    aehnlicheArtikel: toNullableString(row["Ähnliche_Artikel"]),

    rawJson: row,
    updatedAt: new Date(),
  };

  return { rowNumber, modellErweitert, values };
}

export type ImportResult = {
  runId: number;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsError: number;
  errors: string[];
};

const BATCH_SIZE = 100;

export async function importCsvBuffer(
  buffer: Buffer,
  filename: string,
): Promise<ImportResult> {
  const utf8Content = iconv.decode(buffer, "ISO-8859-1");

  const rows: CsvRow[] = parse(utf8Content, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  });

  const [run] = await db
    .insert(importRuns)
    .values({ filename, rowsTotal: rows.length, status: "running" })
    .returning({ id: importRuns.id });

  const errors: string[] = [];
  // Map statt Array: mehrere Zeilen mit demselben Modell_Erweitert kommen in der Quelle vor
  // (z.B. Varianten-Exporte) - Postgres' ON CONFLICT DO UPDATE kann pro Batch-Insert denselben
  // Konfliktschlüssel nicht zweimal behandeln, daher gewinnt die letzte Zeile pro SKU im File.
  const parsedByModell = new Map<string, ParsedRow>();

  rows.forEach((row, index) => {
    const parsed = parseRow(row, index + 2);
    if ("error" in parsed) {
      errors.push(`Zeile ${parsed.rowNumber}: ${parsed.error}`);
    } else {
      parsedByModell.set(parsed.modellErweitert, parsed);
    }
  });

  const parsedRows = Array.from(parsedByModell.values());

  const existingSkus = new Set(
    (await db.select({ modellErweitert: sourceProducts.modellErweitert }).from(sourceProducts)).map(
      (r) => r.modellErweitert,
    ),
  );

  let inserted = 0;
  let updated = 0;
  let errored = errors.length;
  const conflictSet = conflictUpdateSet();
  const totalBatches = Math.ceil(parsedRows.length / BATCH_SIZE);

  for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
    const batch = parsedRows.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    try {
      await db
        .insert(sourceProducts)
        .values(batch.map((r) => r.values))
        .onConflictDoUpdate({ target: sourceProducts.modellErweitert, set: conflictSet });

      for (const r of batch) {
        if (existingSkus.has(r.modellErweitert)) {
          updated++;
        } else {
          inserted++;
          existingSkus.add(r.modellErweitert);
        }
      }
    } catch (err) {
      errored += batch.length;
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
      const message = cause ? cause.message : err instanceof Error ? err.message : String(err);
      console.error(`[csv-import] Batch ${batchNumber}/${totalBatches} fehlgeschlagen: ${message}`);
      errors.push(
        `Zeilen ${batch[0].rowNumber}-${batch[batch.length - 1].rowNumber}: Batch fehlgeschlagen (${message}).`,
      );
    }
  }

  await db
    .update(importRuns)
    .set({
      finishedAt: new Date(),
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsError: errored,
      status: "success",
      errorMessage: errors.length > 0 ? errors.slice(0, 50).join("\n").slice(0, 10_000) : null,
    })
    .where(eq(importRuns.id, run.id));

  return {
    runId: run.id,
    rowsTotal: rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    rowsError: errored,
    errors,
  };
}
