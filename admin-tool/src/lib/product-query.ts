import { and, or, eq, inArray, gte, lte, like, sql, type SQL } from "drizzle-orm";
import { sourceProducts, STATUS_VALUES, type ProductStatus } from "@/db/schema";

export const PAGE_SIZE = 30;

export type ProductFilters = {
  q?: string;
  kategorie1?: string;
  kategorie2?: string;
  kategorie3?: string;
  material?: string[];
  priceMin?: number;
  priceMax?: number;
  caratMin?: number;
  caratMax?: number;
  bestand?: "instock" | "all";
  status?: ProductStatus;
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

export function parseFilters(searchParams: RawSearchParams): ProductFilters {
  const materialRaw = searchParams.material;
  const material = Array.isArray(materialRaw)
    ? materialRaw
    : materialRaw
      ? [materialRaw]
      : undefined;

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
    material: material && material.length > 0 ? material : undefined,
    priceMin: toNumberParam(first(searchParams.priceMin)),
    priceMax: toNumberParam(first(searchParams.priceMax)),
    caratMin: toNumberParam(first(searchParams.caratMin)),
    caratMax: toNumberParam(first(searchParams.caratMax)),
    bestand: first(searchParams.bestand) === "instock" ? "instock" : "all",
    status,
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

  if (filters.priceMin !== undefined) conditions.push(gte(sourceProducts.uvp, filters.priceMin));
  if (filters.priceMax !== undefined) conditions.push(lte(sourceProducts.uvp, filters.priceMax));
  if (filters.caratMin !== undefined) conditions.push(gte(sourceProducts.caratur, filters.caratMin));
  if (filters.caratMax !== undefined) conditions.push(lte(sourceProducts.caratur, filters.caratMax));

  if (filters.bestand === "instock") conditions.push(gte(sourceProducts.bestand, 1));

  if (filters.status) conditions.push(eq(sourceProducts.status, filters.status));

  return conditions.length > 0 ? and(...conditions) : undefined;
}
