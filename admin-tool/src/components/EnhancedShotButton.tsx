"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { BusyNote, Spinner } from "@/components/Busy";
import { generateEnhancedShotForProduct } from "@/lib/background-actions";
import { SHOT_DISTANCES } from "@/lib/shot-distance";
import { DEFAULT_IMAGE_QUALITY, IMAGE_QUALITIES } from "@/lib/image-quality";
import { buttonSecondary, cardClass, selectClass } from "@/lib/ui";

export function EnhancedShotButton({ id, backgrounds, running }: { id: number; backgrounds: { id: number; name: string }[]; running: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState("auto");
  const [distance, setDistance] = useState("auto");
  const [quality, setQuality] = useState<string>(DEFAULT_IMAGE_QUALITY);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const r = await generateEnhancedShotForProduct(id, choice === "auto" ? null : Number(choice), distance === "auto" ? null : distance, quality);
        setInfo(r.queued ? "Auftrag gestartet - das Bild erscheint von selbst, du kannst die Seite verlassen." : "Für dieses Produkt läuft bereits ein Auftrag.");
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
        {info && <p className="fade-in mt-1 text-xs text-emerald-700">{info}</p>}
        {error && <p className="fade-in mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="w-full empty:hidden">
        <BusyNote active={isPending || running} label="KI-Produktbild wird erzeugt" hint="Dauert meist 1–2 Minuten. Du kannst die Seite verlassen - das Bild erscheint von selbst." />
      </div>
      <select className={selectClass} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={isPending || running}>
        <option value="auto">Hintergrund automatisch wählen</option>
        {backgrounds.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <select className={selectClass} value={distance} onChange={(e) => setDistance(e.target.value)} disabled={isPending || running} title="Aus welcher Distanz das Schmuckstück gesehen wird">
        {SHOT_DISTANCES.map((d) => (
          <option key={d.key} value={d.key}>{d.key === "auto" ? "Distanz: automatisch" : d.label}</option>
        ))}
      </select>
      <select className={selectClass} value={quality} onChange={(e) => setQuality(e.target.value)} disabled={isPending || running} title="Bildqualität: niedriger = schneller und günstiger">
        {IMAGE_QUALITIES.map((q) => (
          <option key={q.key} value={q.key}>Qualität: {q.label}</option>
        ))}
      </select>
      <button className={buttonSecondary} onClick={run} disabled={isPending || running || backgrounds.length === 0}>
        {isPending || running ? <Spinner /> : <Sparkles size={14} />} {isPending || running ? "Läuft …" : "Erzeugen"}
      </button>
    </section>
  );
}
