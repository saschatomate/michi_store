import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft, BadgeCheck, Box, Gem, Sparkles, Wallet } from "lucide-react";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { StatusSelect } from "@/components/StatusSelect";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { formatDateTime } from "@/lib/format";
import { cardClass } from "@/lib/ui";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ size?: number }>; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-zinc-900">
      <Icon size={15} />
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
  );
}

const subTh = "py-1.5 pr-3 font-medium";

function diamondSlots(raw: Record<string, string>) {
  const slots = [];
  for (let i = 1; i <= 8; i++) {
    const art = raw[`Diamant${i}_Art`]?.trim();
    if (!art) continue;
    slots.push({
      slot: i,
      art,
      anzahl: raw[`Diamant${i}_Anzahl`]?.trim(),
      carat: raw[`Diamant${i}_Carat`]?.trim(),
      farbe: raw[`Diamant${i}_Farbe`]?.trim(),
      reinheit: raw[`Diamant${i}_Reinheit`]?.trim(),
      schliff: raw[`Diamant${i}_Schliff`]?.trim(),
    });
  }
  return slots;
}

function coloredStoneSlots(raw: Record<string, string>) {
  const slots = [];
  for (let i = 1; i <= 8; i++) {
    const art = raw[`Farbstein${i}_Art`]?.trim();
    if (!art) continue;
    slots.push({
      slot: i,
      art,
      anzahl: raw[`Farbstein${i}_Anzahl`]?.trim(),
      carat: raw[`Farbstein${i}_Carat`]?.trim(),
      farbe: raw[`Farbstein${i}_Farbe`]?.trim(),
      schliff: raw[`Farbstein${i}_Schliff`]?.trim(),
    });
  }
  return slots;
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) notFound();

  const product = await db.query.sourceProducts.findFirst({
    where: eq(sourceProducts.id, productId),
  });
  if (!product) notFound();

  const raw = product.rawJson ?? {};
  const diamonds = diamondSlots(raw);
  const coloredStones = coloredStoneSlots(raw);
  const images = [
    product.freistellerUrl,
    product.modelbildUrl,
    ...(product.bildUrls ?? []),
  ].filter((u): u is string => Boolean(u));

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft size={14} />
        Zurück zur Übersicht
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-zinc-900">
            {product.kurzBezeichnungDe ?? product.modellErweitert}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Modell_Erweitert: <span className="font-mono text-zinc-700">{product.modellErweitert}</span>
          </p>
          {product.giaZertifikatNr && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              <BadgeCheck size={13} />
              GIA-Zertifikat: {product.giaZertifikatNr}
            </span>
          )}
        </div>
        <StatusSelect id={product.id} status={product.status} />
      </div>

      <ProductImageGallery images={images} />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section className={`${cardClass} p-4`}>
          <SectionHeader icon={Box} title="Grunddaten" />
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Hauptkategorie" value={product.hauptkategorie} />
            <Field label="Kategorie 1" value={product.kategorieEbene1} />
            <Field label="Kategorie 2" value={product.kategorieEbene2} />
            <Field label="Kategorie 3" value={product.kategorieEbene3} />
            <Field label="Hauptmaterial" value={product.hauptmaterial} />
            <Field label="Legierung" value={product.legierung} />
            <Field label="Legierungsgewicht" value={product.legierungsgewicht} />
            <Field label="Ringgröße" value={product.ringgroesse} />
            <Field label="Höhe" value={product.hoehe} />
            <Field label="Breite" value={product.breite} />
            <Field label="Durchmesser" value={product.durchmesser} />
            <Field label="Stärke" value={product.staerke} />
            <Field label="Produkt-Länge (cm)" value={product.produktLaengeCm} />
          </dl>
        </section>

        <section className={`${cardClass} p-4`}>
          <SectionHeader icon={Wallet} title="Preise, Bestand & Verlauf" />
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Einkaufspreis" value={product.einkaufspreis ? `${product.einkaufspreis} ${product.einkaufspreisWaehrung ?? ""}` : null} />
            <Field label="UVP" value={product.uvp ? `${product.uvp} ${product.uvpWaehrung ?? ""}` : null} />
            <Field label="Bestand" value={product.bestand} />
            <Field label="Liefertermin" value={product.liefertermin} />
            <Field label="EAN" value={product.eanCode} />
            <Field label="Lieferanten-ArtikelNr" value={product.lieferantenArtikelNr} />
            <Field label="Ähnliche Artikel" value={product.aehnlicheArtikel} />
            <Field label="Shopify Product ID" value={product.shopifyProductId} />
            <Field label="An Pipeline gesendet" value={formatDateTime(product.sentToPipelineAt)} />
            <Field label="Zuletzt aktualisiert" value={formatDateTime(product.updatedAt)} />
          </dl>
        </section>

        <section className={`${cardClass} p-4`}>
          <SectionHeader icon={Gem} title="Diamant (Übersicht)" />
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Caratur" value={product.caratur} />
            <Field label="Anzahl Steine" value={product.anzahlSteine} />
            <Field label="Schliffgüte" value={product.diamantSchliffguete} />
            <Field label="Farbe" value={product.diamantFarbe} />
            <Field label="Reinheit" value={product.diamantReinheit} />
          </dl>

          {diamonds.length > 0 && (
            <table className="mt-4 w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500">
                  <th className={subTh}>Slot</th>
                  <th className={subTh}>Art</th>
                  <th className={subTh}>Anzahl</th>
                  <th className={subTh}>Carat</th>
                  <th className={subTh}>Farbe</th>
                  <th className={subTh}>Reinheit</th>
                  <th className={subTh}>Schliff</th>
                </tr>
              </thead>
              <tbody>
                {diamonds.map((d) => (
                  <tr key={d.slot} className="border-b border-zinc-50 last:border-0">
                    <td className="py-1.5 pr-3 text-zinc-500">{d.slot}</td>
                    <td className="py-1.5 pr-3 text-zinc-900">{d.art}</td>
                    <td className="py-1.5 pr-3 text-zinc-900">{d.anzahl}</td>
                    <td className="py-1.5 pr-3 text-zinc-900">{d.carat}</td>
                    <td className="py-1.5 pr-3 text-zinc-900">{d.farbe}</td>
                    <td className="py-1.5 pr-3 text-zinc-900">{d.reinheit}</td>
                    <td className="py-1.5 pr-3 text-zinc-900">{d.schliff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {(coloredStones.length > 0 || product.caraturFarbstein) && (
          <section className={`${cardClass} p-4`}>
            <SectionHeader icon={Sparkles} title="Farbstein (Übersicht)" />
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Caratur" value={product.caraturFarbstein} />
              <Field label="Anzahl Steine" value={product.anzahlSteineFarbstein} />
            </dl>

            {coloredStones.length > 0 && (
              <table className="mt-4 w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500">
                    <th className={subTh}>Slot</th>
                    <th className={subTh}>Art</th>
                    <th className={subTh}>Anzahl</th>
                    <th className={subTh}>Carat</th>
                    <th className={subTh}>Farbe</th>
                    <th className={subTh}>Schliff</th>
                  </tr>
                </thead>
                <tbody>
                  {coloredStones.map((c) => (
                    <tr key={c.slot} className="border-b border-zinc-50 last:border-0">
                      <td className="py-1.5 pr-3 text-zinc-500">{c.slot}</td>
                      <td className="py-1.5 pr-3 text-zinc-900">{c.art}</td>
                      <td className="py-1.5 pr-3 text-zinc-900">{c.anzahl}</td>
                      <td className="py-1.5 pr-3 text-zinc-900">{c.carat}</td>
                      <td className="py-1.5 pr-3 text-zinc-900">{c.farbe}</td>
                      <td className="py-1.5 pr-3 text-zinc-900">{c.schliff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
