"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { sendSelectedToPipeline } from "@/lib/product-actions";
import type { ProductStatus } from "@/db/schema";

export type ProductListItem = {
  id: number;
  modellErweitert: string;
  kurzBezeichnungDe: string | null;
  kategorieEbene1: string | null;
  hauptmaterial: string | null;
  caratur: number | null;
  uvp: number | null;
  uvpWaehrung: string | null;
  bestand: number | null;
  status: ProductStatus;
  thumbnailUrl: string | null;
};

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function formatPrice(value: number | null, currency: string | null) {
  if (value === null) return "–";
  if (currency && currency !== "EUR") return `${value.toFixed(2)} ${currency}`;
  return currencyFormatter.format(value);
}

export function ProductTable({ products }: { products: ProductListItem[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const allOnPageSelected = products.length > 0 && products.every((p) => selected.has(p.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        products.forEach((p) => next.delete(p.id));
      } else {
        products.forEach((p) => next.add(p.id));
      }
      return next;
    });
  }

  function sendToPipeline() {
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await sendSelectedToPipeline(ids);
      setFeedback(`${result.sent} Artikel in Pipeline gesendet.`);
      setSelected(new Set());
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {feedback && selected.size === 0 && (
        <div className="flex items-center justify-between border-b border-green-200 bg-green-50 px-4 py-2">
          <span className="text-sm text-green-800">{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-xs text-green-700 hover:underline">
            Schließen
          </button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2">
          <span className="text-sm text-amber-900">{selected.size} ausgewählt</span>
          <div className="flex items-center gap-3">
            <button
              onClick={sendToPipeline}
              disabled={isPending}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {isPending ? "Sende…" : "In Pipeline senden"}
            </button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="w-10 px-4 py-2">
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
            </th>
            <th className="px-2 py-2 font-medium">Bild</th>
            <th className="px-2 py-2 font-medium">Bezeichnung</th>
            <th className="px-2 py-2 font-medium">Kategorie</th>
            <th className="px-2 py-2 font-medium">Material</th>
            <th className="px-2 py-2 font-medium text-right">Karat</th>
            <th className="px-2 py-2 font-medium text-right">UVP</th>
            <th className="px-2 py-2 font-medium text-right">Bestand</th>
            <th className="px-2 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">
                Keine Artikel gefunden.
              </td>
            </tr>
          )}
          {products.map((p) => (
            <tr key={p.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50">
              <td className="px-4 py-2">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              </td>
              <td className="px-2 py-2">
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-neutral-100" />
                )}
              </td>
              <td className="px-2 py-2">
                <Link href={`/products/${p.id}`} className="font-medium text-neutral-900 hover:underline">
                  {p.kurzBezeichnungDe ?? p.modellErweitert}
                </Link>
                <div className="text-xs text-neutral-400">{p.modellErweitert}</div>
              </td>
              <td className="px-2 py-2 text-neutral-600">{p.kategorieEbene1 ?? "–"}</td>
              <td className="px-2 py-2 text-neutral-600">{p.hauptmaterial ?? "–"}</td>
              <td className="px-2 py-2 text-right text-neutral-600">
                {p.caratur !== null ? `${p.caratur.toFixed(2)} ct` : "–"}
              </td>
              <td className="px-2 py-2 text-right text-neutral-600">
                {formatPrice(p.uvp, p.uvpWaehrung)}
              </td>
              <td className="px-2 py-2 text-right text-neutral-600">{p.bestand ?? "–"}</td>
              <td className="px-2 py-2">
                <StatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
