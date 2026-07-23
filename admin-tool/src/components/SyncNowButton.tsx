"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { triggerManualSync } from "@/lib/ftp-sync-actions";
import { buttonSecondary, cardClass } from "@/lib/ui";
import type { DailySyncResult } from "@/lib/ftp-sync";

export function SyncNowButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<DailySyncResult | null>(null);

  function run() {
    startTransition(async () => {
      const res = await triggerManualSync();
      setResult(res);
    });
  }

  return (
    <div className={`${cardClass} p-6`}>
      <div className="mb-1 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-zinc-700">Diamond-Group-Sync (FTP)</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Lädt items_dg_40.csv (voller Katalog inkl. Löschungs-Erkennung) und items_dg_stock.csv
            (Bestand/Liefertermin pro Lieferanten-Artikelnummer) manuell - läuft sonst täglich
            automatisch per Vercel Cron.
          </p>
        </div>
        <button onClick={run} disabled={isPending} className={buttonSecondary}>
          <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
          {isPending ? "Synchronisiere…" : "Jetzt synchronisieren"}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          {result.catalogError ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>Katalog-Import (items_dg_40.csv) fehlgeschlagen: {result.catalogError}</span>
            </div>
          ) : result.catalog ? (
            <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={16} />
                Katalog-Import #{result.catalog.runId}: {result.catalog.rowsTotal} Zeilen gelesen.
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span><span className="font-semibold">{result.catalog.rowsInserted}</span> neu</span>
                <span><span className="font-semibold">{result.catalog.rowsUpdated}</span> aktualisiert</span>
                <span><span className="font-semibold">{result.catalog.rowsError}</span> Fehler</span>
              </div>
              {result.catalog.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-emerald-800">
                  {result.catalog.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {result.stockError ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>Bestands-Update (items_dg_stock.csv) fehlgeschlagen: {result.stockError}</span>
            </div>
          ) : result.stock ? (
            <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
              <p className="font-medium">
                Bestands-Update: {result.stock.rowsTotal.toLocaleString("de-DE")} Zeilen in
                items_dg_stock.csv.
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span>
                  <span className="font-semibold">{result.stock.rowsMatched}</span> Artikel
                  aktualisiert (Treffer über Lieferanten-Artikelnummer)
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
