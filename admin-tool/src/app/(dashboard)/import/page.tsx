import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { importRuns } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { UploadForm } from "./UploadForm";

export default async function ImportPage() {
  const history = await db.query.importRuns.findMany({
    orderBy: desc(importRuns.startedAt),
    limit: 20,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">CSV-Import</h1>
        <p className="text-sm text-neutral-500">
          Lädt den Diamond-Group-Katalog in den internen Katalog. Bestehende Artikel werden über
          Modell_Erweitert aktualisiert, Status/Shopify-Zuordnung bleiben erhalten.
        </p>
      </div>

      <UploadForm />

      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-medium text-neutral-900">Import-Historie</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
              <th className="px-4 py-2 font-medium">Datei</th>
              <th className="px-4 py-2 font-medium">Gestartet</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Gesamt</th>
              <th className="px-4 py-2 font-medium text-right">Neu</th>
              <th className="px-4 py-2 font-medium text-right">Aktualisiert</th>
              <th className="px-4 py-2 font-medium text-right">Fehler</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                  Noch kein Import durchgeführt.
                </td>
              </tr>
            )}
            {history.map((run) => (
              <tr key={run.id} className="border-b border-neutral-50 last:border-0">
                <td className="px-4 py-2">{run.filename}</td>
                <td className="px-4 py-2 text-neutral-500">{formatDateTime(run.startedAt)}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      run.status === "success"
                        ? "text-green-700"
                        : run.status === "failed"
                          ? "text-red-700"
                          : "text-amber-700"
                    }
                  >
                    {run.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">{run.rowsTotal}</td>
                <td className="px-4 py-2 text-right">{run.rowsInserted}</td>
                <td className="px-4 py-2 text-right">{run.rowsUpdated}</td>
                <td className="px-4 py-2 text-right">{run.rowsError}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
