"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BusyNote, Spinner } from "@/components/Busy";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import {
  createBackgroundUploadUrl,
  deleteBackground,
  registerBackground,
  updateBackground,
} from "@/lib/background-actions";
import { buttonGhost, buttonPrimary, buttonSecondary, cardClass, inputClass } from "@/lib/ui";

type Item = { id: number; name: string; description: string; categories: string[]; imageUrl: string };

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const parseCategories = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

function Row({ item }: { item: Item }) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [categories, setCategories] = useState(item.categories.join(", "));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== item.name || description !== item.description || categories !== item.categories.join(", ");

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className={`${cardClass} fade-in flex gap-4 p-3 transition-shadow hover:shadow-md ${isPending ? "opacity-60" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.imageUrl} alt={item.name} className="h-28 w-28 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1 space-y-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        <textarea
          className={inputClass}
          rows={2}
          placeholder="Wofür passt der Hintergrund? (z.B. dunkel, für Weißgold und große Steine)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Bevorzugte Kategorien, kommagetrennt (leer = für alles)"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
        />
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              className={buttonPrimary}
              disabled={isPending}
              onClick={() => run(() => updateBackground(item.id, { name, description, categories: parseCategories(categories) }))}
            >
              {isPending ? <Spinner /> : null} Speichern
            </button>
          )}
          <button
            className={buttonGhost}
            disabled={isPending}
            onClick={() => window.confirm(`„${item.name}“ löschen?`) && run(() => deleteBackground(item.id))}
          >
            <Trash2 size={14} /> Löschen
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}

export function BackgroundManager({ backgrounds }: { backgrounds: Item[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function add() {
    if (!file) return setError("Bitte ein Bild auswählen.");
    if (!TYPES.includes(file.type)) return setError("Nur JPG, PNG oder WebP.");
    setError(null);
    startTransition(async () => {
      try {
        const target = await createBackgroundUploadUrl(file.type);
        const body = new FormData();
        body.append("cacheControl", "3600");
        body.append("", file);
        const res = await fetch(target.signedUrl, { method: "PUT", body, headers: { "x-upsert": "false" } });
        if (!res.ok) throw new Error(`Upload fehlgeschlagen (${res.status}).`);
        await registerBackground({ name: name || file.name.replace(/\.[^.]+$/, ""), description, categories: parseCategories(categories), path: target.path });
        setName(""); setDescription(""); setCategories(""); setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className={`${cardClass} space-y-2 p-4`}>
        <div className="text-sm font-medium text-zinc-900">Neuen Hintergrund anlegen</div>
        <div className="flex items-center gap-2">
          <button type="button" className={buttonSecondary} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} /> Bild auswählen
          </button>
          <span className="truncate text-xs text-zinc-500">{file ? file.name : "Noch keine Datei gewählt"}</span>
          <input
            ref={fileRef}
            type="file"
            accept={TYPES.join(",")}
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <input className={inputClass} placeholder="Name (z.B. Dunkler Marmor)" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className={inputClass} rows={2} placeholder="Wofür passt er? (Hilfe für die automatische Auswahl)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className={inputClass} placeholder="Bevorzugte Kategorien, kommagetrennt (optional)" value={categories} onChange={(e) => setCategories(e.target.value)} />
        <button className={buttonPrimary} disabled={isPending} onClick={add}>
          {isPending ? <Spinner /> : <Upload size={14} />} {isPending ? "Lädt hoch …" : "Hinzufügen"}
        </button>
        <BusyNote active={isPending} label="Hintergrund wird hochgeladen" />
        {error && <p className="fade-in text-xs text-red-600">{error}</p>}
      </div>
      {backgrounds.length === 0 && <p className="text-sm text-zinc-500">Noch keine Hintergründe angelegt.</p>}
      {backgrounds.map((b) => (
        <Row key={`${b.id}-${b.name}-${b.description}-${b.categories.join()}`} item={b} />
      ))}
    </div>
  );
}
