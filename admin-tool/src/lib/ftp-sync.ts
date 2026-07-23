import "server-only";
import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import { isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts, importRuns } from "@/db/schema";
import { importCsvBuffer, decodeAndParseCsv, toNullableString, toInt, type ImportResult } from "@/lib/csv-import";

// Diamond Group nennt das "FTP", und es ist auch tatsächlich eines (FileZilla Server, Port 21) -
// zu unterscheiden vom separaten Bild-Server unter derselben Domain, der nur HTTP+Basic-Auth
// spricht (siehe image-generation.ts/image-facts.ts, andere Zwecke).
//
// Die beiden Dateien sind NICHT so aufgeteilt, wie der Name vermuten lässt:
// - items_dg_40.csv ist der VOLLSTÄNDIGE Produktkatalog (alle Spalten, exakt das Format des
//   manuellen CSV-Uploads) - trotz des Namens keine kleine "neu erschienen"-Teilmenge.
// - items_dg_stock.csv ist ein sehr granulares Bestands-Feed pro Lieferanten-Artikelnummer
//   (z.B. pro Ringgröße einzeln, ~40x mehr Zeilen als Produkte im Katalog) mit nur 4 Spalten
//   (Lieferanten-ArtikelNr, EAN-Code, Bestand, Liefertermin) - kein Produktkatalog.
const CATALOG_FILENAME = "items_dg_40.csv";
const STOCK_FILENAME = "items_dg_stock.csv";

function ftpHost(): string {
  const raw = process.env.FTP_URL;
  if (!raw) throw new Error("FTP_URL ist nicht gesetzt (.env.local prüfen).");
  return raw.replace(/^\w+:\/\//, "").replace(/\/+$/, "");
}

async function fetchFtpFile(filename: string): Promise<Buffer> {
  const host = ftpHost();
  const user = process.env.FTP_USER;
  const password = process.env.FTP_PWD;
  if (!user || !password) {
    throw new Error("FTP_USER/FTP_PWD sind nicht gesetzt (.env.local prüfen).");
  }

  const client = new Client();
  try {
    await client.access({ host, user, password, secure: false });
    const chunks: Buffer[] = [];
    const collector = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    await client.downloadTo(collector, filename);
    return Buffer.concat(chunks);
  } catch (err) {
    throw new Error(
      `Datei "${filename}" konnte per FTP nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    client.close();
  }
}

export type StockUpdateResult = { runId: number; rowsTotal: number; rowsMatched: number };

// items_dg_stock.csv ist feingranularer als unser Katalog (pro Lieferanten-ArtikelNr-Variante statt
// pro Modell_Erweitert) - es werden nur Zeilen übernommen, deren ArtikelNr exakt zu einem bekannten
// Produkt passt. Keine Löschungs-Erkennung über diese Datei (andere Granularität, siehe
// Klärung mit dem Nutzer) - nur Bestand/Liefertermin werden für Treffer aktualisiert.
async function applyStockLevels(buffer: Buffer, filename: string): Promise<StockUpdateResult> {
  const rows = decodeAndParseCsv(buffer);

  const [run] = await db
    .insert(importRuns)
    .values({ filename, source: "ftp_auto", rowsTotal: rows.length, status: "running" })
    .returning({ id: importRuns.id });

  const byArtikelNr = new Map<string, { bestand: number | null; liefertermin: string | null }>();
  for (const row of rows) {
    const artikelNr = toNullableString(row["Lieferanten-ArtikelNr"]);
    if (!artikelNr) continue;
    byArtikelNr.set(artikelNr, {
      bestand: toInt(row["Bestand"]),
      liefertermin: toNullableString(row["Liefertermin"]),
    });
  }

  const known = await db
    .select({ id: sourceProducts.id, lieferantenArtikelNr: sourceProducts.lieferantenArtikelNr })
    .from(sourceProducts)
    .where(isNotNull(sourceProducts.lieferantenArtikelNr));

  const matches: { id: number; bestand: number | null; liefertermin: string | null }[] = [];
  for (const p of known) {
    const update = byArtikelNr.get(p.lieferantenArtikelNr!);
    if (update) matches.push({ id: p.id, ...update });
  }

  const UPDATE_BATCH_SIZE = 500;
  for (let i = 0; i < matches.length; i += UPDATE_BATCH_SIZE) {
    const batch = matches.slice(i, i + UPDATE_BATCH_SIZE);
    const valuesSql = sql.join(
      batch.map((m) => sql`(${m.id}::integer, ${m.bestand}::integer, ${m.liefertermin}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE source_products AS sp
      SET bestand = v.bestand, liefertermin = v.liefertermin, updated_at = now()
      FROM (VALUES ${valuesSql}) AS v(id, bestand, liefertermin)
      WHERE sp.id = v.id
    `);
  }

  await db
    .update(importRuns)
    .set({
      finishedAt: new Date(),
      rowsInserted: 0,
      rowsUpdated: matches.length,
      rowsError: 0,
      status: "success",
    })
    .where(sql`${importRuns.id} = ${run.id}`);

  return { runId: run.id, rowsTotal: rows.length, rowsMatched: matches.length };
}

export type DailySyncResult = {
  catalog: ImportResult | null;
  catalogError: string | null;
  stock: StockUpdateResult | null;
  stockError: string | null;
};

export async function runDailySync(): Promise<DailySyncResult> {
  let catalog: ImportResult | null = null;
  let catalogError: string | null = null;
  try {
    const buffer = await fetchFtpFile(CATALOG_FILENAME);
    catalog = await importCsvBuffer(buffer, CATALOG_FILENAME, { source: "ftp_auto", detectDeletions: true });
  } catch (err) {
    catalogError = err instanceof Error ? err.message : String(err);
  }

  let stock: StockUpdateResult | null = null;
  let stockError: string | null = null;
  try {
    const buffer = await fetchFtpFile(STOCK_FILENAME);
    stock = await applyStockLevels(buffer, STOCK_FILENAME);
  } catch (err) {
    stockError = err instanceof Error ? err.message : String(err);
  }

  return { catalog, catalogError, stock, stockError };
}
