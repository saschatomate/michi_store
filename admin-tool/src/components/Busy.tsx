"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

// Sichtbare "Es läuft"-Anzeige für längere Aktionen (Bild-/KI-Generierung): Text, laufende Sekunden und
// ein Balken ohne feste Dauer. Verschwindet von selbst, sobald active false wird.
export function BusyNote({ active, label, hint }: { active: boolean; label: string; hint?: string }) {
  // Innere Komponente wird nur bei active gemountet, dadurch startet der Sekundenzähler jedes Mal bei 0.
  return active ? <BusyNoteInner label={label} hint={hint} /> : null;
}

function BusyNoteInner({ label, hint }: { label: string; hint?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fade-in rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium text-indigo-900">
        <Spinner />
        <span>{label}</span>
        <span className="ml-auto tabular-nums text-xs font-normal text-indigo-700">{seconds} s</span>
      </div>
      {hint && <p className="mt-0.5 text-xs text-indigo-700">{hint}</p>}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-indigo-100">
        <div className="h-full w-1/4 rounded-full bg-indigo-500" style={{ animation: "indeterminate 1.2s ease-in-out infinite" }} />
      </div>
    </div>
  );
}
