import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CustomProductForm } from "@/components/CustomProductForm";
import { listCategoryOptions } from "@/lib/categories";
import { listFamilyMembers } from "@/lib/design-family";
import { EMPTY_FORM } from "@/lib/custom-product";

export default async function NewCustomProductPage() {
  const [categories, families] = await Promise.all([listCategoryOptions({ onlyActive: true }), listFamilyMembers()]);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Zurück zur Übersicht
      </Link>
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">Eigenes Produkt anlegen</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Alle Fakten kommen von dir – die KI formuliert später nur die Texte daraus. Fehlende Pflichtangaben
          sind erlaubt, das Produkt bleibt dann auf „Daten unvollständig“. Bilder lädst du im nächsten Schritt
          hoch.
        </p>
      </div>
      <CustomProductForm productId={null} initial={EMPTY_FORM} categories={categories} missing={[]} families={families} />
    </div>
  );
}
