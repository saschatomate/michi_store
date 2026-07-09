"use client";

import { useActionState } from "react";
import { uploadCsv } from "@/lib/import-actions";

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadCsv, undefined);

  return (
    <form action={action} className="rounded-lg border border-neutral-200 bg-white p-6">
      <label htmlFor="file" className="mb-1 block text-sm font-medium text-neutral-700">
        Diamond-Group CSV-Datei
      </label>
      <p className="mb-3 text-xs text-neutral-500">
        Semikolon-getrennt, ISO-8859-1. Zeilen werden über Modell_Erweitert eingefügt oder
        aktualisiert.
      </p>
      <input
        id="file"
        name="file"
        type="file"
        accept=".csv,text/csv"
        required
        className="mb-4 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Importiere…" : "Import starten"}
      </button>

      {state?.error && <p className="mt-4 text-sm text-red-600">{state.error}</p>}

      {state?.result && (
        <div className="mt-4 rounded-md bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">
            Import #{state.result.runId} abgeschlossen: {state.result.rowsTotal} Zeilen gelesen.
          </p>
          <p>
            {state.result.rowsInserted} neu angelegt, {state.result.rowsUpdated} aktualisiert,{" "}
            {state.result.rowsError} Fehler.
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-green-900">
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
