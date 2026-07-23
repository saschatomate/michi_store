"use client";

import { useState, useTransition } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
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
            Lädt items_dg_stock.csv (voller Katalog inkl. Löschungs-Erkennung) und items_dg_40.csv
            (Neuerscheinungen-Abgleich) manuell - läuft sonst täglich automatisch per Vercel Cron.
          </p>
        </div>
        <button onClick={run} disabled={isPending} className={buttonSecondary}>
          <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
          {isPending ? "Synchronisiere…" : "Jetzt synchronisieren"}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          {result.stockError ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>Stock-Import fehlgeschlagen: {result.stockError}</span>
            </div>
          ) : result.stock ? (
            <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={16} />
                Stock-Import #{result.stock.runId}: {result.stock.rowsTotal} Zeilen gelesen.
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span><span className="font-semibold">{result.stock.rowsInserted}</span> neu</span>
                <span><span className="font-semibold">{result.stock.rowsUpdated}</span> aktualisiert</span>
                <span><span className="font-semibold">{result.stock.rowsError}</span> Fehler</span>
              </div>
              {result.stock.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-emerald-800">
                  {result.stock.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {result.newArrivalsError ? (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>40er-Abgleich übersprungen: {result.newArrivalsError}</span>
            </div>
          ) : result.newArrivals ? (
            <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
              <p className="font-medium">
                40er-Abgleich: {result.newArrivals.total} SKUs in items_dg_40.csv.
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span><span className="font-semibold">{result.newArrivals.newlyFlagged}</span> neu als &bdquo;Neu erschienen&ldquo; markiert</span>
                <span><span className="font-semibold">{result.newArrivals.cleared}</span> zurückgesetzt</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
