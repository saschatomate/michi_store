"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, ShoppingBag } from "lucide-react";
import { approveProductForShop, publishProductToShopify } from "@/lib/shopify-actions";
import { buttonPrimary, buttonSecondary, cardClass } from "@/lib/ui";
import { formatDateTime } from "@/lib/format";
import type { ProductStatus } from "@/db/schema";

export function ShopifyPublishSection({
  id,
  status,
  shopifyStatus,
  syncedAt,
  syncError,
  adminUrl,
}: {
  id: number;
  status: ProductStatus;
  shopifyStatus: string | null;
  syncedAt: Date | null;
  syncError: string | null;
  adminUrl: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function approve() {
    setMessage(null);
    startTransition(async () => {
      const res = await approveProductForShop(id);
      if (!res.ok) setMessage({ kind: "error", text: `Nicht freigegeben: ${res.problems.join(", ")}.` });
    });
  }

  function publish(mode: "draft" | "active") {
    if (mode === "active" && !window.confirm("Produkt LIVE schalten? Es ist danach im Shop für Kunden sichtbar und bestellbar.")) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await publishProductToShopify(id, mode);
      if (res.ok) {
        setMessage({
          kind: "ok",
          text: `${res.created ? "Angelegt" : "Aktualisiert"} in Shopify (${res.status === "active" ? "aktiv" : "Entwurf"}).`,
        });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  const canPublish = status === "freigegeben" || status === "uebertragungsfehler" || status === "veroeffentlicht";

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center gap-2 text-zinc-900">
        <ShoppingBag size={15} />
        <h2 className="text-sm font-semibold">Shop (Shopify)</h2>
      </div>

      {shopifyStatus && (
        <p className="mb-2 text-sm text-zinc-700">
          In Shopify: <strong>{shopifyStatus === "active" ? "aktiv (live)" : "Entwurf"}</strong>
          {syncedAt && <span className="text-zinc-500"> · zuletzt übertragen {formatDateTime(syncedAt)}</span>}
          {adminUrl && (
            <a href={adminUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-indigo-600 hover:underline">
              Im Shopify-Admin öffnen <ExternalLink size={12} />
            </a>
          )}
        </p>
      )}
      {status === "uebertragungsfehler" && syncError && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>Letzte Übertragung fehlgeschlagen: {syncError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status === "review" && (
          <button onClick={approve} disabled={isPending} className={buttonPrimary}>
            Für den Shop freigeben
          </button>
        )}
        {canPublish && (
          <>
            <button onClick={() => publish("draft")} disabled={isPending} className={buttonPrimary}>
              {shopifyStatus ? "In Shopify aktualisieren (Entwurf behalten)" : "Als Entwurf nach Shopify übertragen"}
            </button>
            <button onClick={() => publish("active")} disabled={isPending} className={buttonSecondary}>
              {shopifyStatus === "active" ? "Aktualisieren (live)" : "Live schalten"}
            </button>
          </>
        )}
        {!canPublish && status !== "review" && (
          <span className="text-sm text-zinc-500">
            Übertragung möglich, sobald das Produkt Texte freigegeben hat und für den Shop freigegeben ist.
          </span>
        )}
        {isPending && <span className="text-sm text-zinc-500">Bitte warten…</span>}
      </div>

      {message && (
        <p className={`mt-2 flex items-start gap-1.5 text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>
          {message.kind === "ok" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
          {message.text}
        </p>
      )}
    </section>
  );
}
