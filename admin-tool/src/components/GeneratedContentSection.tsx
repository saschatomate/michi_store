"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Pencil, RefreshCw, Wand2, X, XCircle } from "lucide-react";
import {
  approveProductContent,
  rejectProductContent,
  regenerateProductContent,
  updateProductContent,
} from "@/lib/product-actions";
import { buttonPrimary, buttonSecondary, buttonGhost, cardClass, inputClass } from "@/lib/ui";
import { formatDateTime } from "@/lib/format";
import type { ProductStatus } from "@/db/schema";
import type { GeneratedContent } from "@/lib/text-generation";

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={inputClass}
        />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      )}
    </label>
  );
}

export function GeneratedContentSection({
  id,
  status,
  isApproved,
  approvedAt,
  generatedAt,
  generationError,
  content,
}: {
  id: number;
  status: ProductStatus;
  isApproved: boolean;
  approvedAt: Date | null;
  generatedAt: Date | null;
  generationError: string | null;
  content: GeneratedContent;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEdit() {
    setDraft(content);
    setError(null);
    setIsEditing(true);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateProductContent(id, draft);
        setIsEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      }
    });
  }

  function cancel() {
    setDraft(content);
    setError(null);
    setIsEditing(false);
  }

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <Wand2 size={15} />
          <h2 className="text-sm font-semibold">Generierte Texte</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEditing ? (
            <>
              <button onClick={save} disabled={isPending} className={buttonPrimary}>
                <CheckCircle2 size={14} />
                {isPending ? "Speichere…" : "Speichern"}
              </button>
              <button onClick={cancel} disabled={isPending} className={buttonSecondary}>
                <X size={14} />
                Abbrechen
              </button>
            </>
          ) : (
            <>
              {status === "review" && !isApproved && (
                <button
                  onClick={() => startTransition(() => approveProductContent(id))}
                  disabled={isPending}
                  className={buttonPrimary}
                >
                  <CheckCircle2 size={14} />
                  Freigeben
                </button>
              )}
              {status !== "abgelehnt" && (
                <button
                  onClick={() => startTransition(() => rejectProductContent(id))}
                  disabled={isPending}
                  className={buttonSecondary}
                >
                  <XCircle size={14} />
                  Ablehnen
                </button>
              )}
              {generatedAt && (
                <button onClick={startEdit} disabled={isPending} className={buttonGhost}>
                  <Pencil size={14} />
                  Bearbeiten
                </button>
              )}
              <button
                onClick={() => startTransition(() => regenerateProductContent(id))}
                disabled={isPending}
                className={buttonGhost}
              >
                <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
                {isPending ? "Generiere…" : "Neu generieren"}
              </button>
            </>
          )}
        </div>
      </div>

      {!isEditing && isApproved && approvedAt && (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={13} />
          Freigegeben am {formatDateTime(approvedAt)}
        </p>
      )}

      {!isEditing && generationError && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>Letzte Generierung fehlgeschlagen: {generationError}</span>
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isEditing ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <EditField
              label="Produktname"
              value={draft.productName}
              onChange={(v) => setDraft((d) => ({ ...d, productName: v }))}
            />
            <EditField
              label="Kurzbeschreibung DE"
              value={draft.shortDescDe}
              onChange={(v) => setDraft((d) => ({ ...d, shortDescDe: v }))}
              multiline
            />
            <EditField
              label="Langbeschreibung DE"
              value={draft.longDescDe}
              onChange={(v) => setDraft((d) => ({ ...d, longDescDe: v }))}
              multiline
            />
            <EditField
              label="SEO-Titel"
              value={draft.seoTitle}
              onChange={(v) => setDraft((d) => ({ ...d, seoTitle: v }))}
            />
            <EditField
              label="SEO-Beschreibung"
              value={draft.seoDescription}
              onChange={(v) => setDraft((d) => ({ ...d, seoDescription: v }))}
              multiline
            />
          </div>
          <div className="space-y-3">
            <EditField
              label="Short description EN"
              value={draft.shortDescEn}
              onChange={(v) => setDraft((d) => ({ ...d, shortDescEn: v }))}
              multiline
            />
            <EditField
              label="Long description EN"
              value={draft.longDescEn}
              onChange={(v) => setDraft((d) => ({ ...d, longDescEn: v }))}
              multiline
            />
          </div>
        </div>
      ) : generatedAt ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Produktname" value={content.productName} />
            <Field label="Kurzbeschreibung DE" value={content.shortDescDe} />
            <Field label="Langbeschreibung DE" value={content.longDescDe} />
            <Field label="SEO-Titel" value={content.seoTitle} />
            <Field label="SEO-Beschreibung" value={content.seoDescription} />
          </div>
          <div className="space-y-3">
            <Field label="Short description EN" value={content.shortDescEn} />
            <Field label="Long description EN" value={content.longDescEn} />
          </div>
        </div>
      ) : !generationError ? (
        <p className="text-sm text-zinc-400">Noch keine Texte generiert.</p>
      ) : null}
    </section>
  );
}
