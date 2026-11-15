"use client";

import { useState, useTransition } from "react";
import { setupFilterMetafields } from "@/lib/shopify-actions";
import { buttonSecondary } from "@/lib/ui";

export function FilterMetafieldSetup() {
  const [isPending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setInfo(null);
    setError(null);
    startTransition(async () => {
      try {
        const r = await setupFilterMetafields();
        setInfo(`Angelegt: ${r.created.join(", ") || "–"}. Schon vorhanden: ${r.existing.join(", ") || "–"}.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-xs text-zinc-500">
        Filterfelder in Shopify anlegen (Metallfarbe, Legierung, Schliffform, Karatgruppe) – nötig, damit sie in
        Search &amp; Discovery als Filter wählbar sind. Mehrfaches Ausführen ist unschädlich.
        {info && <span className="ml-1 text-emerald-700">{info}</span>}
        {error && <span className="ml-1 text-red-600">{error}</span>}
      </div>
      <button className={buttonSecondary} onClick={run} disabled={isPending}>
        {isPending ? "Lege an …" : "Filterfelder in Shopify anlegen"}
      </button>
    </div>
  );
}
