"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { uploadCsv } from "@/lib/import-actions";
import { buttonPrimary, cardClass } from "@/lib/ui";

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadCsv, undefined);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <form action={action} className={`${cardClass} p-6`}>
      <label htmlFor="file" className="mb-1 block text-sm font-medium text-zinc-700">
        Diamond-Group CSV-Datei
      </label>
      <p className="mb-3 text-xs text-zinc-500">
        Semikolon-getrennt, ISO-8859-1. Zeilen werden über Modell_Erweitert eingefügt oder
        aktualisiert.
      </p>

      <label
        htmlFor="file"
        className="relative mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50/40"
      >
        {fileName ? (
          <>
            <FileSpreadsheet size={22} className="text-indigo-600" />
            <span className="text-sm font-medium text-zinc-900">{fileName}</span>
            <span className="text-xs text-zinc-500">Andere Datei auswählen…</span>
          </>
        ) : (
          <>
            <Upload size={22} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-700">CSV-Datei auswählen</span>
            <span className="text-xs text-zinc-500">oder hierher ziehen</span>
          </>
        )}
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>

      <button type="submit" disabled={pending} className={buttonPrimary}>
        {pending ? "Importiere…" : "Import starten"}
      </button>

      {state?.error && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state?.result && (
        <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} />
            Import #{state.result.runId} abgeschlossen: {state.result.rowsTotal} Zeilen gelesen.
          </p>
          <div className="mt-3 flex gap-4 text-xs">
            <span>
              <span className="font-semibold text-emerald-900">{state.result.rowsInserted}</span> neu
            </span>
            <span>
              <span className="font-semibold text-emerald-900">{state.result.rowsUpdated}</span>{" "}
              aktualisiert
            </span>
            <span>
              <span className="font-semibold text-emerald-900">{state.result.rowsError}</span> Fehler
            </span>
          </div>
          {state.result.errors.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-emerald-800">
              {state.result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
