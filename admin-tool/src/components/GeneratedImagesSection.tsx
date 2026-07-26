"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ImageIcon, Pencil, RefreshCw, RotateCcw, Trash2, Users, X, XCircle, ZoomIn } from "lucide-react";
import {
  generateProductImages,
  approveProductImage,
  rejectProductImage,
  deleteProductImageVariant,
  regenerateProductImageVariant,
  updateImagePromptOverride,
} from "@/lib/image-actions";
import { buttonPrimary, buttonSecondary, buttonGhost, cardClass, inputClass } from "@/lib/ui";
import { Lightbox } from "@/components/Lightbox";
import type { GeneratedImageStatus } from "@/db/schema";
import type { ModelKey } from "@/lib/image-facts";

export type GeneratedImageItem = {
  id: number;
  variantIndex: number;
  handPreset: string;
  imageUrl: string | null;
  status: GeneratedImageStatus;
  generationError: string | null;
};

export type ModelOption = {
  key: ModelKey;
  name: string;
  referenceImageUrl: string;
  tagline: string;
};

const statusLabel: Record<GeneratedImageStatus, string> = {
  pending_review: "Wartet auf Freigabe",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
};

function ModelPickerModal({
  models,
  recommendedModelKey,
  currentModelKey,
  onConfirm,
  onClose,
}: {
  models: ModelOption[];
  recommendedModelKey: ModelKey;
  currentModelKey: ModelKey | null;
  onConfirm: (modelKey: ModelKey) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(currentModelKey ?? recommendedModelKey);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-zinc-900">Model auswählen</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Das gewählte Model wird für dieses Produkt gespeichert und bei jeder weiteren
          Generierung wiederverwendet.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {models.map((model) => {
            const isSelected = selected === model.key;
            const badge =
              currentModelKey === model.key
                ? "Aktuell verwendet"
                : recommendedModelKey === model.key
                  ? "Empfohlen"
                  : null;
            return (
              <button
                key={model.key}
                type="button"
                onClick={() => setSelected(model.key)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-200"
                    : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
              >
                <Image
                  src={model.referenceImageUrl}
                  alt={model.name}
                  width={64}
                  height={64}
                  className="h-16 w-16 shrink-0 rounded-md border border-zinc-200 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-zinc-900">{model.name}</span>
                    {badge && (
                      <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-snug text-zinc-500">{model.tagline}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-100 pt-4">
          <button onClick={onClose} className={buttonSecondary}>
            Abbrechen
          </button>
          <button onClick={() => onConfirm(selected)} className={buttonPrimary}>
            <RefreshCw size={14} />
            Bilder generieren
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageCard({ item }: { item: GeneratedImageItem }) {
  const [isPending, startTransition] = useTransition();
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      <div className="flex aspect-square items-center justify-center bg-zinc-50">
        {item.imageUrl ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="group relative h-full w-full"
            aria-label="Bild vergrößern"
          >
            <Image
              src={item.imageUrl}
              alt={item.handPreset}
              width={512}
              height={512}
              className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-zinc-900/70 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              <ZoomIn size={12} />
              Vergrößern
            </span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-center text-red-600">
            <AlertCircle size={18} />
            <span className="text-xs">{item.generationError ?? "Fehler bei der Generierung"}</span>
          </div>
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-700">{item.handPreset}</span>
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
        <div className="flex gap-1.5">
          <button
            onClick={() => startTransition(() => regenerateProductImageVariant(item.id))}
            disabled={isPending}
            className={`${buttonGhost} flex-1 px-2 py-1 text-xs`}
          >
            <RefreshCw size={12} className={isPending ? "animate-spin" : ""} />
            Neu
          </button>
          <button
            onClick={() => {
              if (confirm("Dieses Bild wirklich löschen?")) {
                startTransition(() => deleteProductImageVariant(item.id));
              }
            }}
            disabled={isPending}
            className={`${buttonGhost} flex-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50`}
          >
            <Trash2 size={12} />
            Löschen
          </button>
        </div>
      </div>

      {lightboxOpen && item.imageUrl && (
        <Lightbox src={item.imageUrl} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}

export function GeneratedImagesSection({
  id,
  images,
  defaultPrompt,
  promptOverride,
  models,
  recommendedModelKey,
  currentModelKey,
}: {
  id: number;
  images: GeneratedImageItem[];
  defaultPrompt: string;
  promptOverride: string | null;
  models: ModelOption[];
  recommendedModelKey: ModelKey;
  currentModelKey: ModelKey | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(promptOverride ?? defaultPrompt);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasImages = images.length > 0;
  const hasCustomPrompt = Boolean(promptOverride);
  const currentModel = models.find((m) => m.key === currentModelKey);

  function startEditPrompt() {
    setDraftPrompt(promptOverride ?? defaultPrompt);
    setIsEditingPrompt(true);
  }

  function saveAndGenerate() {
    startTransition(async () => {
      await updateImagePromptOverride(id, draftPrompt);
      setIsEditingPrompt(false);
    });
  }

  function resetToDefault() {
    startTransition(async () => {
      await updateImagePromptOverride(id, "");
      setDraftPrompt(defaultPrompt);
      setIsEditingPrompt(false);
    });
  }

  function confirmModelAndGenerate(modelKey: ModelKey) {
    setPickerOpen(false);
    startTransition(() => generateProductImages(id, modelKey));
  }

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <ImageIcon size={15} />
          <h2 className="text-sm font-semibold">Generierte Bilder</h2>
          {currentModel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              <Users size={11} />
              {currentModel.name}
            </span>
          )}
          {hasCustomPrompt && !isEditingPrompt && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              Individueller Prompt aktiv
            </span>
          )}
        </div>
        {!isEditingPrompt && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={startEditPrompt} disabled={isPending} className={buttonGhost}>
              <Pencil size={14} />
              Prompt bearbeiten
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={isPending}
              className={hasImages ? buttonGhost : buttonPrimary}
            >
              <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
              {isPending ? "Generiere…" : hasImages ? "Neu generieren" : "Bilder generieren"}
            </button>
          </div>
        )}
      </div>

      {isEditingPrompt ? (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">
              Prompt (gilt für alle Varianten, Model/Pose wird automatisch ergänzt)
            </span>
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={8}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={saveAndGenerate} disabled={isPending} className={buttonPrimary}>
              <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
              {isPending ? "Generiere…" : "Speichern & neu generieren"}
            </button>
            <button
              onClick={() => setIsEditingPrompt(false)}
              disabled={isPending}
              className={buttonSecondary}
            >
              <X size={14} />
              Abbrechen
            </button>
            {hasCustomPrompt && (
              <button onClick={resetToDefault} disabled={isPending} className={buttonGhost}>
                <RotateCcw size={14} />
                Auf Standard zurücksetzen
              </button>
            )}
          </div>
        </div>
      ) : hasImages ? (
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

      {pickerOpen && (
        <ModelPickerModal
          models={models}
          recommendedModelKey={recommendedModelKey}
          currentModelKey={currentModelKey}
          onClose={() => setPickerOpen(false)}
          onConfirm={confirmModelAndGenerate}
        />
      )}
    </section>
  );
}
