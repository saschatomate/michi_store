"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ShoppingCart } from "lucide-react";
import { updateShopData } from "@/lib/shop-data-actions";
import { buttonGhost, buttonPrimary, cardClass, inputClass } from "@/lib/ui";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

// Alles, was nach Shopify geht (Titel, Preis, Beschreibung), mit dem automatischen Vorschlag und der
// Möglichkeit, jedes Feld von Hand zu überschreiben. Leer lassen = automatisch.
export function ShopDataSection({
  id,
  uvp,
  isCustom,
  autoPrice,
  autoTitle,
  autoDescription,
  hasIntro,
  override,
}: {
  id: number;
  uvp: number | null;
  isCustom: boolean;
  autoPrice: number | null;
  autoTitle: string;
  autoDescription: string;
  hasIntro: boolean;
  override: { title: string; price: string; description: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(override.title);
  const [price, setPrice] = useState(override.price);
  const [description, setDescription] = useState(override.description);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty = title !== override.title || price !== override.price || description !== override.description;
  const rawPrice = price.trim().replace(/\s|€/g, "");
  const parsedPrice = Number(rawPrice.includes(",") ? rawPrice.replace(/\./g, "").replace(",", ".") : rawPrice);
  const effectivePrice = price.trim() && Number.isFinite(parsedPrice) ? parsedPrice : autoPrice;

  function save() {
    setMessage(null);
    startTransition(async () => {
      try {
        await updateShopData(id, { title, price, description });
        setMessage({ kind: "ok", text: "Gespeichert." });
        router.refresh();
      } catch (err) {
        setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-1 flex items-center gap-2 text-zinc-900">
        <ShoppingCart size={15} />
        <h2 className="text-sm font-semibold">Shop-Daten (so geht es nach Shopify)</h2>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Titel, Preis und Beschreibung entstehen automatisch aus den Produktdaten. Jedes Feld lässt sich hier von Hand
        überschreiben - leer lassen heißt automatisch.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Titel</span>
          <input className={inputClass} value={title} placeholder={autoTitle} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-600">Verkaufspreis (EUR)</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={price}
            placeholder={autoPrice !== null ? String(autoPrice) : "Preis eingeben"}
            onChange={(e) => setPrice(e.target.value)}
          />
          <p className="mt-1 text-xs text-zinc-500">
            {uvp !== null && (
              <>
                {isCustom ? "Eingegebener Preis" : "DG-UVP"}: {eur.format(uvp)} ·{" "}
              </>
            )}
            {autoPrice !== null && (
              <>
                {isCustom ? "automatisch" : "automatisch auf Hunderter abgerundet"}: {eur.format(autoPrice)} ·{" "}
              </>
            )}
            <strong className="text-zinc-800">
              im Shop: {effectivePrice !== null ? eur.format(effectivePrice) : "–"}
              {price.trim() ? " (manuell)" : ""}
            </strong>
          </p>
        </div>

        <label className="block md:col-span-2">
          <span className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-600">
            <span>Beschreibung</span>
            <span className="flex items-center gap-2 font-normal text-zinc-500">
              {!hasIntro && !description.trim() && "Kein Kategorie-Intro hinterlegt (Kategorien → Intro-Text)."}
              {description.trim() ? (
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => setDescription("")}>
                  Zurück auf automatisch
                </button>
              ) : (
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => setDescription(autoDescription)}>
                  Automatischen Text bearbeiten
                </button>
              )}
            </span>
          </span>
          {description.trim() ? (
            <textarea className={inputClass} rows={12} value={description} onChange={(e) => setDescription(e.target.value)} />
          ) : (
            <pre className="whitespace-pre-wrap rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3.5 py-3 font-sans text-sm text-zinc-700">
              {autoDescription || "Noch keine Produktdaten vorhanden."}
            </pre>
          )}
          <span className="mt-1 block text-xs text-zinc-500">
            Darunter hängt Shopify automatisch die Lieferzeit an. Absätze mit Leerzeile trennen.
          </span>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={isPending || !dirty} className={buttonPrimary}>
          {isPending ? "Speichere…" : "Speichern"}
        </button>
        {dirty && (
          <button
            onClick={() => {
              setTitle(override.title);
              setPrice(override.price);
              setDescription(override.description);
            }}
            disabled={isPending}
            className={buttonGhost}
          >
            Verwerfen
          </button>
        )}
        {message && (
          <span className={`flex items-center gap-1.5 text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>
            {message.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
