import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db/client";
import { sourceProducts, productCategories } from "@/db/schema";
import { CustomProductForm } from "@/components/CustomProductForm";
import { CustomImageManager } from "@/components/CustomImageManager";
import { StatusBadge } from "@/components/StatusBadge";
import { listCategoryOptions } from "@/lib/categories";
import { listFamilyMembers } from "@/lib/design-family";
import { formFromProduct, getMissingFields } from "@/lib/custom-product";

export default async function EditCustomProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) notFound();

  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, productId) });
  if (!product) notFound();
  // DG-Artikel gehören dem Lieferanten und werden nicht im Editor bearbeitet.
  if (product.origin !== "custom") redirect(`/products/${productId}`);

  const [allCategories, selected] = await Promise.all([
    listCategoryOptions(),
    db
      .select({ id: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.sourceProductId, productId)),
  ]);
  const categoryIds = selected.map((r) => r.id);
  // Inaktive Kategorien nur anbieten, wenn das Produkt sie schon hat - sonst würden sie beim
  // Speichern still entfernt.
  const categories = allCategories.filter((c) => c.active || categoryIds.includes(c.id));
  const families = await listFamilyMembers(productId);
  const missing = getMissingFields(product, product.customImages?.length ?? 0, categoryIds.length);

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href={`/products/${productId}`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft size={14} />
        Zurück zum Produkt
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-zinc-900">
            {product.kurzBezeichnungDe ?? product.modellErweitert}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Eigenes Produkt · SKU <span className="font-mono text-zinc-700">{product.modellErweitert}</span>
          </p>
        </div>
        <StatusBadge status={product.status} />
      </div>
      <CustomImageManager productId={productId} images={product.customImages ?? []} />
      <CustomProductForm
        productId={productId}
        initial={formFromProduct(product, categoryIds)}
        categories={categories}
        missing={missing}
        families={families}
      />
    </div>
  );
}
