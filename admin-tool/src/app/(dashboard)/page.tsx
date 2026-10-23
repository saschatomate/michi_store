import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { ProductTable, type ProductListItem } from "@/components/ProductTable";
import { parseFilters, buildWhere, isNewArrival, PAGE_SIZE } from "@/lib/product-query";
import { latestShopifyEvents } from "@/lib/shopify-activity";
import { isShopifyOutOfSync } from "@/lib/shopify-sync";
import { summarizeChanges } from "@/lib/shopify-changes";
import { inArray } from "drizzle-orm";

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
        newArrivalAt: sourceProducts.newArrivalAt,
        missingFromStockAt: sourceProducts.missingFromStockAt,
        origin: sourceProducts.origin,
        discontinued: sourceProducts.discontinued,
        shopifyProductId: sourceProducts.shopifyProductId,
        shopifyStatus: sourceProducts.shopifyStatus,
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

  // Shopify-Kennzeichnung: neuestes Ereignis pro Produkt + "nicht aktuell" (nur für Produkte, die
  // schon in Shopify liegen - die Abweichung wird dafür live berechnet).
  const inShopifyIds = rows.filter((r) => r.shopifyProductId).map((r) => r.id);
  const [events, shopifyRows] = await Promise.all([
    latestShopifyEvents(inShopifyIds),
    inShopifyIds.length > 0
      ? db.select().from(sourceProducts).where(inArray(sourceProducts.id, inShopifyIds))
      : Promise.resolve([]),
  ]);
  const outOfSync = new Map<number, boolean>(
    await Promise.all(shopifyRows.map(async (p) => [p.id, await isShopifyOutOfSync(p).catch(() => false)] as const)),
  );

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
    isNewArrival: isNewArrival(r.newArrivalAt),
    isMissingFromStock: r.missingFromStockAt !== null,
    isCustom: r.origin === "custom",
    isDiscontinued: r.discontinued,
    shopifyStatus: r.shopifyProductId ? r.shopifyStatus : null,
    shopifyOutOfSync: outOfSync.get(r.id) ?? false,
    shopifyLastEvent: events.get(r.id)
      ? {
          action: events.get(r.id)!.action,
          at: events.get(r.id)!.createdAt,
          summary: summarizeChanges(events.get(r.id)!.changes),
        }
      : null,
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
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-zinc-900">Produkte</h1>
        <p className="mt-0.5 text-sm text-zinc-500">{count.toLocaleString("de-DE")} Artikel gefunden.</p>
      </div>

      <ProductTable products={products} />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 text-sm">
          <Link
            href={pageHref(Math.max(1, filters.page - 1))}
            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 font-medium ${filters.page <= 1 ? "pointer-events-none text-zinc-300" : "text-zinc-600 hover:bg-white"}`}
          >
            <ChevronLeft size={15} />
            Zurück
          </Link>
          <span className="rounded-xl bg-indigo-600 px-3.5 py-1.5 font-medium text-white shadow-sm shadow-indigo-600/30">
            Seite {filters.page} von {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, filters.page + 1))}
            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 font-medium ${filters.page >= totalPages ? "pointer-events-none text-zinc-300" : "text-zinc-600 hover:bg-white"}`}
          >
            Weiter
            <ChevronRight size={15} />
          </Link>
        </div>
      )}
    </div>
  );
}
