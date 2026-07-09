import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { eq, sql } from "drizzle-orm";
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

export type ImportResult = {
  runId: number;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsError: number;
  errors: string[];
};

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

  let inserted = 0;
  let updated = 0;
  let errored = 0;
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    try {
      const modellErweitert = toNullableString(row["Modell_Erweitert"]);
      if (!modellErweitert) {
        errored++;
        errors.push(`Zeile ${index + 2}: Modell_Erweitert fehlt, übersprungen.`);
        continue;
      }

      const beschaffenheit = toNullableString(row["Beschaffenheit"]);

      const values = {
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
        updatedAt: sql`(current_timestamp)`,
      };

      const existing = await db.query.sourceProducts.findFirst({
        where: eq(sourceProducts.modellErweitert, modellErweitert),
        columns: { id: true },
      });

      if (existing) {
        await db
          .update(sourceProducts)
          .set(values)
          .where(eq(sourceProducts.modellErweitert, modellErweitert));
        updated++;
      } else {
        await db.insert(sourceProducts).values(values);
        inserted++;
      }
    } catch (err) {
      errored++;
      errors.push(`Zeile ${index + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await db
    .update(importRuns)
    .set({
      finishedAt: sql`(current_timestamp)`,
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsError: errored,
      status: "success",
      errorMessage: errors.length > 0 ? errors.slice(0, 50).join("\n") : null,
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
