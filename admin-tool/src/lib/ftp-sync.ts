import "server-only";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { and, isNotNull, isNull, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts, importRuns } from "@/db/schema";
import { importCsvBuffer, type ImportResult } from "@/lib/csv-import";

const STOCK_FILENAME = "items_dg_stock.csv";
const NEW_ARRIVALS_FILENAME = "items_dg_40.csv";

// Der Lieferant (Diamond Group) nennt das "FTP", tatsächlich ist es ein per HTTP-Basic-Auth
// geschützter Verzeichnis-Server (siehe FTP_URL/FTP_USER/FTP_PWD in .env.local) - kein echtes FTP.
async function fetchFtpFile(filename: string): Promise<Buffer> {
  const base = process.env.FTP_URL;
  const user = process.env.FTP_USER;
  const pwd = process.env.FTP_PWD;
  if (!base || !user || !pwd) {
    throw new Error("FTP_URL/FTP_USER/FTP_PWD sind nicht gesetzt (.env.local prüfen).");
  }

  const url = new URL(filename, base).toString();
  const auth = "Basic " + Buffer.from(`${user}:${pwd}`).toString("base64");
  const response = await fetch(url, { headers: { Authorization: auth } });
  if (!response.ok) {
    throw new Error(`Datei "${filename}" konnte nicht geladen werden (${response.status}): ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Liest nur die Modell_Erweitert-Spalte (SKU) - dieselbe CSV-Form wie items_dg_stock.csv, aber für
// den 40er-Abgleich reicht der Schlüssel, die restlichen Spalten kommen bereits über den
// Stock-Import in die Datenbank.
function parseSkuColumn(buffer: Buffer): Set<string> {
  const utf8Content = iconv.decode(buffer, "ISO-8859-1");
  const rows: Record<string, string>[] = parse(utf8Content, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  });

  const skus = new Set<string>();
  for (const row of rows) {
    const sku = row["Modell_Erweitert"]?.trim();
    if (sku) skus.add(sku);
  }
  return skus;
}

export type DailySyncResult = {
  stock: ImportResult | null;
  stockError: string | null;
  newArrivals: { total: number; newlyFlagged: number; cleared: number } | null;
  newArrivalsError: string | null;
};

export async function runDailySync(): Promise<DailySyncResult> {
  let stock: ImportResult | null = null;
  let stockError: string | null = null;

  try {
    const stockBuffer = await fetchFtpFile(STOCK_FILENAME);
    stock = await importCsvBuffer(stockBuffer, STOCK_FILENAME, {
      source: "ftp_auto",
      detectDeletions: true,
    });
  } catch (err) {
    stockError = err instanceof Error ? err.message : String(err);
    // Ohne Katalog-Basis ist ein 40er-Abgleich sinnlos - Lauf hier beenden.
    return { stock, stockError, newArrivals: null, newArrivalsError: null };
  }

  let newArrivals: DailySyncResult["newArrivals"] = null;
  let newArrivalsError: string | null = null;

  try {
    const arrivalsBuffer = await fetchFtpFile(NEW_ARRIVALS_FILENAME);
    const skus = parseSkuColumn(arrivalsBuffer);
    const skuList = Array.from(skus);

    if (skuList.length === 0) {
      newArrivalsError = `"${NEW_ARRIVALS_FILENAME}" enthielt keine gültigen SKUs - Abgleich übersprungen.`;
    } else {
      const newlyFlagged = await db
        .update(sourceProducts)
        .set({ newArrivalAt: new Date() })
        .where(and(isNull(sourceProducts.newArrivalAt), inArray(sourceProducts.modellErweitert, skuList)))
        .returning({ id: sourceProducts.id });

      const cleared = await db
        .update(sourceProducts)
        .set({ newArrivalAt: null })
        .where(and(isNotNull(sourceProducts.newArrivalAt), notInArray(sourceProducts.modellErweitert, skuList)))
        .returning({ id: sourceProducts.id });

      newArrivals = { total: skuList.length, newlyFlagged: newlyFlagged.length, cleared: cleared.length };

      // Eigener Import-Historie-Eintrag für den 40er-Abgleich, damit er in der bestehenden
      // Historie-Tabelle sichtbar ist, ohne eine neue Tabelle einzuführen.
      await db.insert(importRuns).values({
        filename: NEW_ARRIVALS_FILENAME,
        source: "ftp_auto",
        rowsTotal: skuList.length,
        rowsInserted: newlyFlagged.length,
        rowsUpdated: cleared.length,
        rowsError: 0,
        status: "success",
        finishedAt: new Date(),
      });
    }
  } catch (err) {
    newArrivalsError = err instanceof Error ? err.message : String(err);
  }

  return { stock, stockError, newArrivals, newArrivalsError };
}
