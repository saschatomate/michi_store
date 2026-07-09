import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { StatusSelect } from "@/components/StatusSelect";
import { formatDateTime } from "@/lib/format";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-sm text-neutral-900">{value}</dd>
    </div>
  );
}

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
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            {product.kurzBezeichnungDe ?? product.modellErweitert}
          </h1>
          <p className="text-sm text-neutral-500">
            Modell_Erweitert: <span className="font-mono">{product.modellErweitert}</span>
          </p>
          {product.giaZertifikatNr && (
            <span className="mt-2 inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
              GIA-Zertifikat: {product.giaZertifikatNr}
            </span>
          )}
        </div>
        <StatusSelect id={product.id} status={product.status} />
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-3 rounded-lg border border-neutral-200 bg-white p-4">
          {images.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt=""
              className={i === 0 ? "h-48 w-48 rounded object-cover" : "h-24 w-24 rounded object-cover"}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-900">Grunddaten</h2>
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

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-900">Preise, Bestand & Verlauf</h2>
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

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-900">Diamant (Übersicht)</h2>
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
                <tr className="border-b border-neutral-100 text-left text-neutral-500">
                  <th className="py-1 pr-2">Slot</th>
                  <th className="py-1 pr-2">Art</th>
                  <th className="py-1 pr-2">Anzahl</th>
                  <th className="py-1 pr-2">Carat</th>
                  <th className="py-1 pr-2">Farbe</th>
                  <th className="py-1 pr-2">Reinheit</th>
                  <th className="py-1 pr-2">Schliff</th>
                </tr>
              </thead>
              <tbody>
                {diamonds.map((d) => (
                  <tr key={d.slot} className="border-b border-neutral-50 last:border-0">
                    <td className="py-1 pr-2">{d.slot}</td>
                    <td className="py-1 pr-2">{d.art}</td>
                    <td className="py-1 pr-2">{d.anzahl}</td>
                    <td className="py-1 pr-2">{d.carat}</td>
                    <td className="py-1 pr-2">{d.farbe}</td>
                    <td className="py-1 pr-2">{d.reinheit}</td>
                    <td className="py-1 pr-2">{d.schliff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {(coloredStones.length > 0 || product.caraturFarbstein) && (
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-neutral-900">Farbstein (Übersicht)</h2>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Caratur" value={product.caraturFarbstein} />
              <Field label="Anzahl Steine" value={product.anzahlSteineFarbstein} />
            </dl>

            {coloredStones.length > 0 && (
              <table className="mt-4 w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-neutral-500">
                    <th className="py-1 pr-2">Slot</th>
                    <th className="py-1 pr-2">Art</th>
                    <th className="py-1 pr-2">Anzahl</th>
                    <th className="py-1 pr-2">Carat</th>
                    <th className="py-1 pr-2">Farbe</th>
                    <th className="py-1 pr-2">Schliff</th>
                  </tr>
                </thead>
                <tbody>
                  {coloredStones.map((c) => (
                    <tr key={c.slot} className="border-b border-neutral-50 last:border-0">
                      <td className="py-1 pr-2">{c.slot}</td>
                      <td className="py-1 pr-2">{c.art}</td>
                      <td className="py-1 pr-2">{c.anzahl}</td>
                      <td className="py-1 pr-2">{c.carat}</td>
                      <td className="py-1 pr-2">{c.farbe}</td>
                      <td className="py-1 pr-2">{c.schliff}</td>
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
