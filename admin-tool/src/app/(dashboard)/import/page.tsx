import { desc } from "drizzle-orm";
import { History } from "lucide-react";
import { db } from "@/db/client";
import { importRuns } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { cardClass } from "@/lib/ui";
import { UploadForm } from "./UploadForm";

const statusDot: Record<string, string> = {
  success: "bg-emerald-500",
  failed: "bg-red-500",
  running: "bg-amber-500",
};

const statusText: Record<string, string> = {
  success: "text-emerald-700",
  failed: "text-red-700",
  running: "text-amber-700",
};

const thClass = "px-4 py-2.5 font-medium";

export default async function ImportPage() {
  const history = await db.query.importRuns.findMany({
    orderBy: desc(importRuns.startedAt),
    limit: 20,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">CSV-Import</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Lädt den Diamond-Group-Katalog in den internen Katalog. Bestehende Artikel werden über
          Modell_Erweitert aktualisiert, Status/Shopify-Zuordnung bleiben erhalten.
        </p>
      </div>

      <UploadForm />

      <div className={`overflow-hidden ${cardClass}`}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <History size={15} className="text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900">Import-Historie</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className={thClass}>Datei</th>
                <th className={thClass}>Gestartet</th>
                <th className={thClass}>Status</th>
                <th className={`${thClass} text-right`}>Gesamt</th>
                <th className={`${thClass} text-right`}>Neu</th>
                <th className={`${thClass} text-right`}>Aktualisiert</th>
                <th className={`${thClass} text-right`}>Fehler</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-400">
                    Noch kein Import durchgeführt.
                  </td>
                </tr>
              )}
              {history.map((run) => (
                <tr key={run.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2.5 font-medium text-zinc-900">{run.filename}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{formatDateTime(run.startedAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${statusText[run.status] ?? "text-zinc-600"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDot[run.status] ?? "bg-zinc-400"}`} />
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{run.rowsTotal}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{run.rowsInserted}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{run.rowsUpdated}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{run.rowsError}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
