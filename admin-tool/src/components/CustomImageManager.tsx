"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ImagePlus, Trash2, AlertCircle } from "lucide-react";
import {
  createImageUploadUrls,
  registerCustomImages,
  removeCustomImage,
  reorderCustomImages,
} from "@/lib/custom-product-actions";
import { buttonSecondary, cardClass } from "@/lib/ui";
import type { CustomImage } from "@/db/schema";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function CustomImageManager({ productId, images }: { productId: number; images: CustomImage[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await task();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStatus(null);
      }
    });
  }

  function onFilesChosen(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const unsupported = files.find((f) => !ACCEPTED.includes(f.type));
    if (unsupported) {
      setError(`"${unsupported.name}": nur JPG, PNG oder WebP werden unterstützt.`);
      return;
    }

    run(async () => {
      setStatus(`Lade ${files.length} Bild${files.length > 1 ? "er" : ""} hoch…`);
      const targets = await createImageUploadUrls(
        productId,
        files.map((f) => ({ contentType: f.type })),
      );

      // Direkt vom Browser zu Supabase Storage (Originalqualität, kein Größenlimit des Server-Action-
      // Bodys) - dieselbe Form wie storage-js' uploadToSignedUrl.
      await Promise.all(
        files.map(async (file, i) => {
          const body = new FormData();
          body.append("cacheControl", "3600");
          body.append("", file);
          const res = await fetch(targets[i].signedUrl, { method: "PUT", body, headers: { "x-upsert": "false" } });
          if (!res.ok) throw new Error(`Upload von "${file.name}" fehlgeschlagen (${res.status}).`);
        }),
      );

      await registerCustomImages(
        productId,
        targets.map((t) => t.path),
      );
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function move(index: number, delta: -1 | 1) {
    const paths = images.map((i) => i.path);
    const target = index + delta;
    if (target < 0 || target >= paths.length) return;
    [paths[index], paths[target]] = [paths[target], paths[index]];
    run(() => reorderCustomImages(productId, paths));
  }

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Bilder</h2>
          <p className="text-xs text-zinc-500">Das erste Bild ist das Hauptbild. JPG, PNG oder WebP.</p>
        </div>
        <button type="button" disabled={isPending} onClick={() => inputRef.current?.click()} className={buttonSecondary}>
          <ImagePlus size={15} />
          Bilder hinzufügen
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => onFilesChosen(e.target.files)}
        />
      </div>

      {status && <p className="mb-3 text-sm text-indigo-700">{status}</p>}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-400">
          Noch keine Bilder hochgeladen.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img, i) => (
            <li key={img.path} className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="relative aspect-square bg-zinc-50">
                <Image src={img.url} alt="" fill sizes="200px" className="object-cover" />
                {i === 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    HAUPTBILD
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-zinc-100 px-1.5 py-1">
                <div className="flex">
                  <button
                    type="button"
                    disabled={isPending || i === 0}
                    onClick={() => move(i, -1)}
                    title="Nach vorn"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || i === images.length - 1}
                    onClick={() => move(i, 1)}
                    title="Nach hinten"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (window.confirm("Dieses Bild wirklich löschen?")) run(() => removeCustomImage(productId, img.path));
                  }}
                  title="Löschen"
                  className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
