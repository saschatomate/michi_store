"use client";

import { useTransition } from "react";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ImageIcon, RefreshCw, XCircle } from "lucide-react";
import { generateProductImages, approveProductImage, rejectProductImage } from "@/lib/image-actions";
import { buttonPrimary, buttonSecondary, buttonGhost, cardClass } from "@/lib/ui";
import { HAND_PRESETS } from "@/lib/image-facts";
import type { GeneratedImageStatus } from "@/db/schema";

export type GeneratedImageItem = {
  id: number;
  variantIndex: number;
  handPreset: string;
  imageUrl: string | null;
  status: GeneratedImageStatus;
  generationError: string | null;
};

function presetLabel(key: string): string {
  return HAND_PRESETS.find((p) => p.key === key)?.label ?? key;
}

const statusLabel: Record<GeneratedImageStatus, string> = {
  pending_review: "Wartet auf Freigabe",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
};

function ImageCard({ item }: { item: GeneratedImageItem }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      <div className="flex aspect-square items-center justify-center bg-zinc-50">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={presetLabel(item.handPreset)}
            width={512}
            height={512}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-center text-red-600">
            <AlertCircle size={18} />
            <span className="text-xs">{item.generationError ?? "Fehler bei der Generierung"}</span>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-700">{presetLabel(item.handPreset)}</span>
          <span
            className={
              item.status === "approved"
                ? "text-xs font-medium text-emerald-700"
                : item.status === "rejected"
                  ? "text-xs font-medium text-zinc-400"
                  : "text-xs font-medium text-amber-700"
            }
          >
            {statusLabel[item.status]}
          </span>
        </div>
        {item.imageUrl && (
          <div className="flex gap-1.5">
            {item.status !== "approved" && (
              <button
                onClick={() => startTransition(() => approveProductImage(item.id))}
                disabled={isPending}
                className={`${buttonPrimary} flex-1 px-2 py-1 text-xs`}
              >
                <CheckCircle2 size={12} />
                Freigeben
              </button>
            )}
            {item.status !== "rejected" && (
              <button
                onClick={() => startTransition(() => rejectProductImage(item.id))}
                disabled={isPending}
                className={`${buttonSecondary} flex-1 px-2 py-1 text-xs`}
              >
                <XCircle size={12} />
                Ablehnen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function GeneratedImagesSection({ id, images }: { id: number; images: GeneratedImageItem[] }) {
  const [isPending, startTransition] = useTransition();
  const hasImages = images.length > 0;

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <ImageIcon size={15} />
          <h2 className="text-sm font-semibold">Generierte Bilder</h2>
        </div>
        <button
          onClick={() => startTransition(() => generateProductImages(id))}
          disabled={isPending}
          className={hasImages ? buttonGhost : buttonPrimary}
        >
          <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
          {isPending ? "Generiere…" : hasImages ? "Neu generieren" : "Bilder generieren"}
        </button>
      </div>

      {hasImages ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {images
            .slice()
            .sort((a, b) => a.variantIndex - b.variantIndex)
            .map((item) => (
              <ImageCard key={item.id} item={item} />
            ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">Noch keine Bilder generiert.</p>
      )}
    </section>
  );
}
