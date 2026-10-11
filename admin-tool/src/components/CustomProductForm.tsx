"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Save } from "lucide-react";
import { saveCustomProduct } from "@/lib/custom-product-actions";
import {
  CERT_INSTITUTES,
  CLARITIES,
  CUT_QUALITIES,
  CUT_SHAPES,
  DIAMOND_COLORS,
  FIELD_LABELS,
  FINENESS_OPTIONS,
  GOLD_COLORS,
  PRODUCT_TYPES,
  STONE_ORIGIN_LABELS,
  suggestDesignFamilyId,
  type CustomProductForm as FormValues,
  type FamilyMember,
} from "@/lib/custom-product";
import { suggestCategoryIds } from "@/lib/category-rules";
import type { CategoryOption } from "@/lib/categories";
import { buttonPrimary, buttonSecondary, cardClass, inputClass, selectClass } from "@/lib/ui";


function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-zinc-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-4`}>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function CustomProductForm({
  productId,
  initial,
  categories,
  missing,
  families,
}: {
  productId: number | null;
  initial: FormValues;
  categories: CategoryOption[];
  // Bereits vergebene Design-Family-IDs mit ihren Produkten (ohne das aktuelle Produkt).
  families: FamilyMember[];
  // Beim Bearbeiten: zuletzt gespeicherte Lücken (inkl. Bilder), damit sie sofort sichtbar sind.
  missing: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missingFields, setMissingFields] = useState<string[]>(missing);
  const [saved, setSaved] = useState(false);
  // Die Design-Family-ID folgt dem Vorschlag (Name + Schmuckart), bis jemand sie selbst ändert.
  const [familyTouched, setFamilyTouched] = useState(initial.designFamilyId !== "");
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function toggleCategory(id: number) {
    set("categoryIds", form.categoryIds.includes(id) ? form.categoryIds.filter((c) => c !== id) : [...form.categoryIds, id]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveCustomProduct(productId, { ...form, designFamilyId: familyValue });
      if (!result.ok) {
        setErrors(result.errors);
        setSaved(false);
        return;
      }
      setErrors({});
      setMissingFields(result.missing);
      setSaved(true);
      if (productId === null) {
        // Erst nach dem Anlegen gibt es eine Produkt-ID, an der Bilder hängen können.
        router.push(`/products/${result.id}/edit`);
      } else {
        router.refresh();
      }
    });
  }

  const err = (key: string) => errors[key];
  const familySuggestion = suggestDesignFamilyId(form.name, form.productType);
  const familyValue = familyTouched ? form.designFamilyId : familySuggestion;
  const familyMembers = familyValue.trim() ? families.filter((m) => m.familyId === familyValue.trim()) : [];
  const isRing = form.productType === "ring";
  const suggested = suggestCategoryIds(categories, { stoneOrigin: form.stoneOrigin, productType: form.productType }).filter(
    (id) => categories.some((c) => c.id === id),
  );
  const missingSuggestions = suggested.filter((id) => !form.categoryIds.includes(id));

  return (
    <form onSubmit={submit} className="space-y-5">
      {missingFields.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Daten unvollständig</strong> – das Produkt kann nicht weiter in den Prozess, bis folgendes
            ergänzt ist: {missingFields.map((m) => FIELD_LABELS[m] ?? m).join(", ")}.
          </span>
        </div>
      )}

      <Section title="Basis">
        <div className="sm:col-span-2">
          <Field label="Produktname (intern)" error={err("name")}>
            <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
        </div>
        <Field label="Schmuckart" error={err("productType")}>
          <select
            className={selectClass}
            value={form.productType}
            onChange={(e) => set("productType", e.target.value as FormValues["productType"])}
          >
            <option value="">– wählen –</option>
            {Object.entries(PRODUCT_TYPES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <Field
            label="Design-Family-ID"
            hint="Verbindet Ausführungen desselben Designs („Auch in Gelbgold erhältlich“). Wird aus Name und Schmuckart vorgeschlagen – bei Bedarf ändern."
            error={err("designFamilyId")}
          >
            <input
              className={inputClass}
              value={familyValue}
              onChange={(e) => {
                setFamilyTouched(true);
                set("designFamilyId", e.target.value);
              }}
            />
          </Field>
          {familyTouched && familySuggestion && familyValue !== familySuggestion && (
            <button
              type="button"
              onClick={() => {
                setFamilyTouched(false);
                setSaved(false);
              }}
              className="mt-1 text-xs text-indigo-600 hover:underline"
            >
              Vorschlag wiederherstellen: {familySuggestion}
            </button>
          )}
          {familyMembers.length > 0 ? (
            <div className="mt-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-900">
              Gehört dann zu einer Familie mit {familyMembers.length} weiteren Produkt
              {familyMembers.length === 1 ? "" : "en"}:
              <ul className="mt-0.5 list-disc pl-4">
                {familyMembers.map((m) => (
                  <li key={m.id}>
                    {m.name}
                    {m.detail && <span className="text-indigo-700"> ({m.detail})</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            familyValue.trim() && (
              <p className="mt-1 text-xs text-zinc-500">Neue Familie – noch kein anderes Produkt hat diese ID.</p>
            )
          )}
        </div>
        <div className="sm:col-span-2">
          <Field label="Beschreibung / Notizen (optional)" hint="Die Texte für den Shop erzeugt später die KI aus den Fakten.">
            <textarea
              rows={2}
              className={inputClass}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Material">
        <Field label="Goldfarbe" error={err("goldColor")}>
          <select className={selectClass} value={form.goldColor} onChange={(e) => set("goldColor", e.target.value)}>
            <option value="">– wählen –</option>
            {GOLD_COLORS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Goldlegierung" error={err("fineness")}>
          <select className={selectClass} value={form.fineness} onChange={(e) => set("fineness", e.target.value)}>
            <option value="">– wählen –</option>
            {FINENESS_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rhodiniert" error={err("rhodiniert")}>
          <select
            className={selectClass}
            value={form.rhodiniert}
            onChange={(e) => set("rhodiniert", e.target.value as FormValues["rhodiniert"])}
          >
            <option value="">– wählen –</option>
            <option value="yes">Ja</option>
            <option value="no">Nein</option>
          </select>
        </Field>
        <Field label="Schmuckgewicht (g, optional)" error={err("weightG")}>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.weightG}
            onChange={(e) => set("weightG", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Diamant / Steine">
        <Field label="Labor- oder Naturdiamant" error={err("stoneOrigin")}>
          <select
            className={selectClass}
            value={form.stoneOrigin}
            onChange={(e) => set("stoneOrigin", e.target.value as FormValues["stoneOrigin"])}
          >
            <option value="">– wählen –</option>
            {Object.entries(STONE_ORIGIN_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Schliffform" error={err("cutShape")}>
          <select className={selectClass} value={form.cutShape} onChange={(e) => set("cutShape", e.target.value)}>
            <option value="">– wählen –</option>
            {CUT_SHAPES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Schliffqualität (Cut)" error={err("cutQuality")}>
          <select className={selectClass} value={form.cutQuality} onChange={(e) => set("cutQuality", e.target.value)}>
            <option value="">– wählen –</option>
            {CUT_QUALITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Anzahl Steine" error={err("stoneCount")}>
          <input
            className={inputClass}
            inputMode="numeric"
            value={form.stoneCount}
            onChange={(e) => set("stoneCount", e.target.value)}
          />
        </Field>
        <Field label="Gewicht Hauptstein (ct)" error={err("mainStoneCt")}>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.mainStoneCt}
            onChange={(e) => set("mainStoneCt", e.target.value)}
          />
        </Field>
        <Field label="Gesamtgewicht aller Steine (ct)" error={err("totalCt")}>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.totalCt}
            onChange={(e) => set("totalCt", e.target.value)}
          />
        </Field>
        <Field label="Farbe (Color)" error={err("diamondColor")}>
          <select
            className={selectClass}
            value={form.diamondColor}
            onChange={(e) => set("diamondColor", e.target.value)}
          >
            <option value="">– wählen –</option>
            {DIAMOND_COLORS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Reinheit (Clarity)" error={err("clarity")}>
          <select className={selectClass} value={form.clarity} onChange={(e) => set("clarity", e.target.value)}>
            <option value="">– wählen –</option>
            {CLARITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Zertifikatsinstitut (falls vorhanden)" error={err("certInstitute")}>
          <select
            className={selectClass}
            value={form.certInstitute}
            onChange={(e) => set("certInstitute", e.target.value)}
          >
            <option value="">– kein Zertifikat –</option>
            {CERT_INSTITUTES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Zertifikatsnummer" error={err("certNumber")}>
          <input
            className={inputClass}
            value={form.certNumber}
            onChange={(e) => set("certNumber", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Preis & Größen">
        <Field label="Verkaufspreis (EUR, brutto)" error={err("uvp")}>
          <input className={inputClass} inputMode="decimal" value={form.uvp} onChange={(e) => set("uvp", e.target.value)} />
        </Field>
        <Field label="Einkaufspreis (EUR, optional)" error={err("purchasePrice")}>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.purchasePrice}
            onChange={(e) => set("purchasePrice", e.target.value)}
          />
        </Field>
        {isRing && (
          <div className="sm:col-span-2">
            <Field
              label="Verfügbare Ringgrößen"
              hint="Mit Komma oder Leerzeichen trennen, z.B. 50, 52, 54, 56, 58."
              error={err("ringSizes")}
            >
              <input
                className={inputClass}
                value={form.ringSizes}
                onChange={(e) => set("ringSizes", e.target.value)}
              />
            </Field>
          </div>
        )}
      </Section>

      <section className={`${cardClass} p-4`}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Kategorien</h2>
        {missingSuggestions.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            <span>
              Vorschlag nach Regeln:{" "}
              {missingSuggestions.map((id) => categories.find((c) => c.id === id)?.label).join(" | ")}
            </span>
            <button
              type="button"
              onClick={() => set("categoryIds", Array.from(new Set([...form.categoryIds, ...missingSuggestions])))}
              className={buttonSecondary}
            >
              Übernehmen
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={form.categoryIds.includes(c.id)}
                onChange={() => toggleCategory(c.id)}
                className="h-3.5 w-3.5 rounded border-zinc-300 accent-indigo-600"
              />
              {c.label}
            </label>
          ))}
        </div>
        {err("categories") && <p className="mt-2 text-xs text-red-600">{err("categories")}</p>}
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={isPending} className={buttonPrimary}>
          <Save size={15} />
          {isPending ? "Speichere…" : productId === null ? "Produkt anlegen" : "Speichern"}
        </button>
        {saved && productId !== null && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 size={15} />
            Gespeichert
          </span>
        )}
        {Object.keys(errors).length > 0 && (
          <span className="text-sm text-red-600">Bitte die markierten Felder korrigieren.</span>
        )}
      </div>
    </form>
  );
}
