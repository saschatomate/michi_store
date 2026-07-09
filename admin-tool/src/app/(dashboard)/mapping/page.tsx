import Link from "next/link";
import { ne, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";

export default async function MappingPage() {
  const rows = await db
    .select({
      id: sourceProducts.id,
      modellErweitert: sourceProducts.modellErweitert,
      kurzBezeichnungDe: sourceProducts.kurzBezeichnungDe,
      status: sourceProducts.status,
      shopifyProductId: sourceProducts.shopifyProductId,
      updatedAt: sourceProducts.updatedAt,
    })
    .from(sourceProducts)
    .where(ne(sourceProducts.status, "neu"))
    .orderBy(desc(sourceProducts.updatedAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Mapping</h1>
        <p className="text-sm text-neutral-500">
          Modell_Erweitert ↔ Status ↔ Shopify Product ID – der Original-SKU-Schlüssel bleibt auch
          nach künftiger Umbenennung erhalten und ist über das gesamte System hinweg
          nachvollziehbar. Marinell-Produktname und Shopify-ID werden erst durch die spätere
          Pipeline (Komponente B/C) befüllt.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
              <th className="px-4 py-2 font-medium">Modell_Erweitert</th>
              <th className="px-4 py-2 font-medium">Bezeichnung</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Shopify Product ID</th>
              <th className="px-4 py-2 font-medium">Zuletzt aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Noch keine Artikel in der Pipeline oder veröffentlicht.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-50 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{r.modellErweitert}</td>
                <td className="px-4 py-2">
                  <Link href={`/products/${r.id}`} className="hover:underline">
                    {r.kurzBezeichnungDe ?? "–"}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 text-neutral-500">{r.shopifyProductId ?? "–"}</td>
                <td className="px-4 py-2 text-neutral-500">{formatDateTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
