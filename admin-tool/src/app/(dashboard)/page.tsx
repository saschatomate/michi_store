import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { FilterBar } from "@/components/FilterBar";
import { ProductTable, type ProductListItem } from "@/components/ProductTable";
import { parseFilters, buildWhere, PAGE_SIZE } from "@/lib/product-query";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function ProductListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseFilters(rawParams);
  const where = buildWhere(filters);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: sourceProducts.id,
        modellErweitert: sourceProducts.modellErweitert,
        kurzBezeichnungDe: sourceProducts.kurzBezeichnungDe,
        kategorieEbene1: sourceProducts.kategorieEbene1,
        hauptmaterial: sourceProducts.hauptmaterial,
        caratur: sourceProducts.caratur,
        uvp: sourceProducts.uvp,
        uvpWaehrung: sourceProducts.uvpWaehrung,
        bestand: sourceProducts.bestand,
        status: sourceProducts.status,
        freistellerUrl: sourceProducts.freistellerUrl,
        bildUrls: sourceProducts.bildUrls,
      })
      .from(sourceProducts)
      .where(where)
      .orderBy(desc(sourceProducts.createdAt))
      .limit(PAGE_SIZE)
      .offset((filters.page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)` })
      .from(sourceProducts)
      .where(where),
  ]);

  const products: ProductListItem[] = rows.map((r) => ({
    id: r.id,
    modellErweitert: r.modellErweitert,
    kurzBezeichnungDe: r.kurzBezeichnungDe,
    kategorieEbene1: r.kategorieEbene1,
    hauptmaterial: r.hauptmaterial,
    caratur: r.caratur,
    uvp: r.uvp,
    uvpWaehrung: r.uvpWaehrung,
    bestand: r.bestand,
    status: r.status,
    thumbnailUrl: r.freistellerUrl ?? r.bildUrls?.[0] ?? null,
  }));

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const paginationParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (key === "page" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => paginationParams.append(key, v));
    else paginationParams.set(key, value);
  }

  function pageHref(page: number) {
    const params = new URLSearchParams(paginationParams);
    params.set("page", String(page));
    return `/?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Produkte</h1>
        <p className="text-sm text-neutral-500">{count} Artikel gefunden.</p>
      </div>

      <FilterBar filters={filters} />

      <ProductTable products={products} />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Link
            href={pageHref(Math.max(1, filters.page - 1))}
            className={`rounded-md px-3 py-1.5 ${filters.page <= 1 ? "pointer-events-none text-neutral-300" : "text-neutral-600 hover:bg-neutral-100"}`}
          >
            Zurück
          </Link>
          <span className="text-neutral-500">
            Seite {filters.page} von {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, filters.page + 1))}
            className={`rounded-md px-3 py-1.5 ${filters.page >= totalPages ? "pointer-events-none text-neutral-300" : "text-neutral-600 hover:bg-neutral-100"}`}
          >
            Weiter
          </Link>
        </div>
      )}
    </div>
  );
}
