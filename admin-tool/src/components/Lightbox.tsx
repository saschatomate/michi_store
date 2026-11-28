"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Per Portal direkt in <body>: Die Seiten-Animation (.page-enter) lässt ein transform zurück, das
  // "fixed" an den (langen) Seiten-Container bindet - das Bild erschien dann weit unten statt im Fenster.
  // Seiten-Scrollen bleibt gesperrt, solange die Lightbox offen ist.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/80 p-8"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        aria-label="Schließen"
      >
        <X size={20} />
      </button>
      <div onClick={(e) => e.stopPropagation()}>
        <Image
          src={src}
          alt=""
          width={1000}
          height={1000}
          className="max-h-[90vh] max-w-full w-auto rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>,
    document.body,
  );
}
