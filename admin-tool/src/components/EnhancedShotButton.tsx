"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { generateEnhancedShotForProduct } from "@/lib/background-actions";
import { buttonSecondary, cardClass, selectClass } from "@/lib/ui";

export function EnhancedShotButton({ id, backgrounds }: { id: number; backgrounds: { id: number; name: string }[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState("auto");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const r = await generateEnhancedShotForProduct(id, choice === "auto" ? null : Number(choice));
        setInfo(`Bild 1 erzeugt auf „${r.backgroundName}“ – bitte prüfen und freigeben.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        router.refresh();
      }
    });
  }

  return (
    <section className={`${cardClass} flex flex-wrap items-center gap-3 p-4`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-900">KI-Produktbild auf Hintergrund</div>
        <p className="text-xs text-zinc-500">
          Erstes DG-Bild auf einem Hintergrund aus der Bibliothek, veredelt (Auflösung, Licht, Kratzer). Ersetzt Bild 1,
          sofern es nicht freigegeben ist.
        </p>
        {info && <p className="mt-1 text-xs text-emerald-700">{info}</p>}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <select className={selectClass} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={isPending}>
        <option value="auto">Hintergrund automatisch wählen</option>
        {backgrounds.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <button className={buttonSecondary} onClick={run} disabled={isPending || backgrounds.length === 0}>
        <Sparkles size={14} /> {isPending ? "Erzeuge …" : "Erzeugen"}
      </button>
    </section>
  );
}
