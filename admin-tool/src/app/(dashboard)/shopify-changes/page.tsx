import Link from "next/link";
import { Radio } from "lucide-react";
import { listShopifyFeed } from "@/lib/shopify-activity";
import { ShopifyChangeDetails, ShopifyEventHeader } from "@/components/ShopifyChangeList";
import { cardClass } from "@/lib/ui";

export default async function ShopifyChangesPage() {
  const feed = await listShopifyFeed(200);

  // Nach Tag gruppieren, damit "heute" auf einen Blick erkennbar ist.
  const byDay = new Map<string, typeof feed>();
  for (const item of feed) {
    const day = item.createdAt.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">Shopify-Verlauf</h1>
        <p className="mt-0.5 flex items-start gap-1.5 text-sm text-zinc-500">
          <Radio size={15} className="mt-0.5 shrink-0 text-orange-500" />
          <span>
            Jede Änderung, die in Richtung Shopify gegangen ist – manuell oder durch den Nachtjob: was
            geändert wurde (alt → neu), wann und durch wen. Die letzten 200 Ereignisse.
          </span>
        </p>
      </div>

      {feed.length === 0 && (
        <p className={`${cardClass} px-4 py-10 text-center text-sm text-zinc-400`}>
          Noch nichts nach Shopify übertragen oder geändert.
        </p>
      )}

      {Array.from(byDay.entries()).map(([day, items]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">{day}</h2>
          <div className={`${cardClass} divide-y divide-zinc-100`}>
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <ShopifyEventHeader action={item.action} actor={item.actor} createdAt={item.createdAt} />
                <div className="mt-1">
                  <Link href={`/products/${item.productId}`} className="text-sm font-medium text-indigo-600 hover:underline">
                    {item.name ?? item.sku}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-zinc-400">{item.sku}</span>
                </div>
                <ShopifyChangeDetails changes={item.changes} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
