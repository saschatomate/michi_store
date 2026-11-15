"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { BusyNote } from "@/components/Busy";

// Läuft in jeder Dashboard-Seite: solange KI-Bilder im Hintergrund entstehen, wird die aktuelle Seite alle
// paar Sekunden aufgefrischt - dadurch erscheint ein fertiges Bild von selbst, egal auf welcher Seite man ist.
// Wer die Seite später (neu) öffnet, sieht das Ergebnis ohnehin direkt.
export function JobsBanner({ active, recentDone, recentFailed }: { active: number; recentDone: number; recentFailed: number }) {
  const router = useRouter();
  const wasActive = useRef(false);

  useEffect(() => {
    if (active > 0) {
      wasActive.current = true;
      const t = setInterval(() => router.refresh(), 4000);
      return () => clearInterval(t);
    }
    wasActive.current = false;
  }, [active, router]);

  if (active > 0) {
    return (
      <div className="mb-4">
        <BusyNote
          active
          label={`${active} KI-Produktbild${active === 1 ? " wird" : "er werden"} im Hintergrund erzeugt`}
          hint="Du kannst die Seite wechseln oder schließen - fertige Bilder erscheinen von selbst."
        />
      </div>
    );
  }
  if (recentDone > 0 || recentFailed > 0) {
    return (
      <div className="fade-in mb-4 space-y-1 text-sm">
        {recentDone > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-emerald-800">
            <CheckCircle2 size={15} /> {recentDone} KI-Produktbild{recentDone === 1 ? " ist" : "er sind"} fertig und liegt zur Freigabe im Produkt.
          </div>
        )}
        {recentFailed > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-red-700">
            <AlertCircle size={15} /> {recentFailed} KI-Produktbild{recentFailed === 1 ? "" : "er"} fehlgeschlagen - Details im jeweiligen Produkt.
          </div>
        )}
      </div>
    );
  }
  return null;
}
