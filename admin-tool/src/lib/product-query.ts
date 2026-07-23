import { and, or, eq, inArray, gte, lte, like, isNotNull, sql, type SQL } from "drizzle-orm";
import { sourceProducts, STATUS_VALUES, type ProductStatus } from "@/db/schema";

export const PAGE_SIZE = 30;

// "Neu erschienen" heißt: die SKU wurde innerhalb der letzten NEW_ARRIVAL_WINDOW_DAYS Tage zum
// ersten Mal importiert (newArrivalAt wird nur bei Erstanlage gesetzt, siehe csv-import.ts) - kein
// Abgleich gegen eine separate Datei nötig, das Badge verschwindet einfach automatisch, sobald das
// Fenster abgelaufen ist. 40 Tage angelehnt an den Namen der täglichen Diamond-Group-Datei.
export const NEW_ARRIVAL_WINDOW_DAYS = 40;

export function isNewArrival(newArrivalAt: Date | null): boolean {
  if (!newArrivalAt) return false;
  const windowMs = NEW_ARRIVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return newArrivalAt.getTime() > Date.now() - windowMs;
}

export type ProductFilters = {
  q?: string;
  kategorie1?: string;
  kategorie2?: string;
  kategorie3?: string;
  material?: string[];
  legierung?: string[];
  priceMin?: number;
  priceMax?: number;
  caratMin?: number;
  caratMax?: number;
  bestandMin?: number;
  importRunId?: number;
  status?: ProductStatus;
  newArrivalOnly?: boolean;
  missingOnly?: boolean;
  page: number;
};

type RawSearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toNumberParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toStringArray(value: string | string[] | undefined): string[] | undefined {
  const arr = Array.isArray(value) ? value : value ? [value] : undefined;
  return arr && arr.length > 0 ? arr : undefined;
}

export function parseFilters(searchParams: RawSearchParams): ProductFilters {
  const material = toStringArray(searchParams.material);
  const legierung = toStringArray(searchParams.legierung);

  const statusRaw = first(searchParams.status);
  const status =
    statusRaw && STATUS_VALUES.includes(statusRaw as ProductStatus)
      ? (statusRaw as ProductStatus)
      : undefined;

  return {
    q: first(searchParams.q) || undefined,
    kategorie1: first(searchParams.kategorie1) || undefined,
    kategorie2: first(searchParams.kategorie2) || undefined,
    kategorie3: first(searchParams.kategorie3) || undefined,
    material,
    legierung,
    priceMin: toNumberParam(first(searchParams.priceMin)),
    priceMax: toNumberParam(first(searchParams.priceMax)),
    caratMin: toNumberParam(first(searchParams.caratMin)),
    caratMax: toNumberParam(first(searchParams.caratMax)),
    bestandMin: toNumberParam(first(searchParams.bestandMin)),
    importRunId: toNumberParam(first(searchParams.importRunId)),
    status,
    newArrivalOnly: first(searchParams.newArrivalOnly) === "1" || undefined,
    missingOnly: first(searchParams.missingOnly) === "1" || undefined,
    page: Math.max(1, toNumberParam(first(searchParams.page)) ?? 1),
  };
}

export function buildWhere(filters: ProductFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.q) {
    const term = `%${filters.q.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${sourceProducts.kurzBezeichnungDe})`, term),
        like(sql`lower(${sourceProducts.langBezeichnungDe})`, term),
        like(sql`lower(${sourceProducts.modellErweitert})`, term),
        like(sql`lower(${sourceProducts.eanCode})`, term),
      )!,
    );
  }

  if (filters.kategorie1) conditions.push(eq(sourceProducts.kategorieEbene1, filters.kategorie1));
  if (filters.kategorie2) conditions.push(eq(sourceProducts.kategorieEbene2, filters.kategorie2));
  if (filters.kategorie3) conditions.push(eq(sourceProducts.kategorieEbene3, filters.kategorie3));

  if (filters.material && filters.material.length > 0) {
    conditions.push(inArray(sourceProducts.hauptmaterial, filters.material));
  }
  if (filters.legierung && filters.legierung.length > 0) {
    conditions.push(inArray(sourceProducts.legierung, filters.legierung));
  }

  if (filters.priceMin !== undefined) conditions.push(gte(sourceProducts.uvp, filters.priceMin));
  if (filters.priceMax !== undefined) conditions.push(lte(sourceProducts.uvp, filters.priceMax));
  if (filters.caratMin !== undefined) conditions.push(gte(sourceProducts.caratur, filters.caratMin));
  if (filters.caratMax !== undefined) conditions.push(lte(sourceProducts.caratur, filters.caratMax));

  if (filters.bestandMin !== undefined) conditions.push(gte(sourceProducts.bestand, filters.bestandMin));

  if (filters.importRunId !== undefined) {
    conditions.push(eq(sourceProducts.firstSeenImportRunId, filters.importRunId));
  }

  if (filters.status) conditions.push(eq(sourceProducts.status, filters.status));

  if (filters.newArrivalOnly) {
    conditions.push(gte(sourceProducts.newArrivalAt, sql`now() - interval '${sql.raw(String(NEW_ARRIVAL_WINDOW_DAYS))} days'`));
  }
  if (filters.missingOnly) conditions.push(isNotNull(sourceProducts.missingFromStockAt));

  return conditions.length > 0 ? and(...conditions) : undefined;
}
