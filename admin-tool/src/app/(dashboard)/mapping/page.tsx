import Link from "next/link";
import { ne, desc } from "drizzle-orm";
import { Link2, PackageSearch } from "lucide-react";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { cardClass } from "@/lib/ui";

const thClass = "px-4 py-2.5 font-medium";

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
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">Mapping</h1>
        <p className="mt-0.5 flex items-start gap-1.5 text-sm text-zinc-500">
          <Link2 size={15} className="mt-0.5 shrink-0 text-zinc-400" />
          <span>
            Modell_Erweitert ↔ Status ↔ Shopify Product ID – der Original-SKU-Schlüssel bleibt auch
            nach künftiger Umbenennung erhalten und ist über das gesamte System hinweg
            nachvollziehbar. Marinell-Produktname und Shopify-ID werden erst durch die spätere
            Pipeline (Komponente B/C) befüllt.
          </span>
        </p>
      </div>

      <div className={`overflow-hidden ${cardClass}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className={thClass}>Modell_Erweitert</th>
                <th className={thClass}>Bezeichnung</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Shopify Product ID</th>
                <th className={thClass}>Zuletzt aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <PackageSearch size={28} strokeWidth={1.5} />
                      <span className="text-sm">Noch keine Artikel in der Pipeline oder veröffentlicht.</span>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-700">{r.modellErweitert}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/products/${r.id}`} className="font-medium text-zinc-900 hover:text-indigo-600">
                      {r.kurzBezeichnungDe ?? "–"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{r.shopifyProductId ?? "–"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{formatDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
