"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { Lightbox } from "@/components/Lightbox";
import { cardClass } from "@/lib/ui";

export function ProductImageGallery({ images }: { images: string[] }) {
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (images.length === 0) return null;

  function prev() {
    setSelected((i) => (i - 1 + images.length) % images.length);
  }
  function next() {
    setSelected((i) => (i + 1) % images.length);
  }

  return (
    <div className={`${cardClass} p-4`}>
      <div className="relative mx-auto flex w-full max-w-md items-center justify-center">
        {images.length > 1 && (
          <button
            type="button"
            onClick={prev}
            aria-label="Vorheriges Bild"
            className="absolute left-2 z-10 rounded-full border border-zinc-200 bg-white/90 p-1.5 text-zinc-600 shadow-sm hover:bg-white"
          >
            <ChevronLeft size={18} />
          </button>
        )}

        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="group relative"
          aria-label="Bild vergrößern"
        >
          <Image
            src={images[selected]}
            alt=""
            width={420}
            height={420}
            className="h-80 w-80 rounded-xl border border-zinc-100 object-cover shadow-sm transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-md"
          />
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-zinc-900/70 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            <ZoomIn size={12} />
            Vergrößern
          </span>
        </button>

        {images.length > 1 && (
          <button
            type="button"
            onClick={next}
            aria-label="Nächstes Bild"
            className="absolute right-2 z-10 rounded-full border border-zinc-200 bg-white/90 p-1.5 text-zinc-600 shadow-sm hover:bg-white"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-4 flex justify-center gap-2 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              className={`shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                i === selected ? "border-indigo-500" : "border-transparent hover:border-zinc-300"
              }`}
            >
              <Image
                src={url}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 rounded-md object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && <Lightbox src={images[selected]} onClose={() => setLightboxOpen(false)} />}
    </div>
  );
}
