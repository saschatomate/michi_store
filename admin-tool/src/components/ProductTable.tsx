"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { PackageSearch, Send, X, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Lightbox } from "@/components/Lightbox";
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

const thClass = "px-3 py-2.5 font-medium";
const MAX_BATCH_SIZE = 20;

export function ProductTable({ products }: { products: ProductListItem[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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
      setFeedback(`${result.sent} Artikel in Pipeline gesendet, Texte generiert.`);
      setSelected(new Set());
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-sm">
      {feedback && selected.size === 0 && (
        <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 size={15} />
            {feedback}
          </span>
          <button
            onClick={() => setFeedback(null)}
            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-indigo-100 bg-indigo-50 px-4 py-2.5">
          <span className="text-sm font-medium text-indigo-900">
            {selected.size} ausgewählt
            {selected.size > MAX_BATCH_SIZE && (
              <span className="ml-2 font-normal text-amber-700">
                — maximal {MAX_BATCH_SIZE} auf einmal, bitte Auswahl reduzieren
              </span>
            )}
          </span>
          <button
            onClick={sendToPipeline}
            disabled={isPending || selected.size > MAX_BATCH_SIZE}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={14} />
            {isPending ? "Sende…" : "In Pipeline senden"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-indigo-600"
                />
              </th>
              <th className={thClass}>Bild</th>
              <th className={thClass}>Bezeichnung</th>
              <th className={thClass}>Kategorie</th>
              <th className={thClass}>Material</th>
              <th className={`${thClass} text-right`}>Karat</th>
              <th className={`${thClass} text-right`}>UVP</th>
              <th className={`${thClass} text-right`}>Bestand</th>
              <th className={thClass}>Status</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-2 text-zinc-400">
                    <PackageSearch size={28} strokeWidth={1.5} />
                    <span className="text-sm">Keine Artikel gefunden.</span>
                  </div>
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="h-3.5 w-3.5 rounded border-zinc-300 accent-indigo-600"
                  />
                </td>
                <td className="px-3 py-2">
                  {p.thumbnailUrl ? (
                    <button
                      type="button"
                      onClick={() => setLightboxSrc(p.thumbnailUrl)}
                      className="block overflow-hidden rounded-lg transition-transform hover:scale-105"
                    >
                      <Image
                        src={p.thumbnailUrl}
                        alt=""
                        width={56}
                        height={56}
                        className="h-14 w-14 rounded-lg border border-zinc-200 object-cover"
                      />
                    </button>
                  ) : (
                    <div className="h-14 w-14 rounded-lg border border-zinc-200 bg-zinc-50" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/products/${p.id}`}
                    className="font-medium text-zinc-900 hover:text-indigo-600"
                  >
                    {p.kurzBezeichnungDe ?? p.modellErweitert}
                  </Link>
                  <div className="font-mono text-xs text-zinc-400">{p.modellErweitert}</div>
                </td>
                <td className="px-3 py-2 text-zinc-600">{p.kategorieEbene1 ?? "–"}</td>
                <td className="px-3 py-2 text-zinc-600">{p.hauptmaterial ?? "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600">
                  {p.caratur !== null ? `${p.caratur.toFixed(2)} ct` : "–"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-zinc-900">
                  {formatPrice(p.uvp, p.uvpWaehrung)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{p.bestand ?? "–"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
