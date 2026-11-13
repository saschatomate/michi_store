import { Image as ImageIcon } from "lucide-react";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { imageBackgrounds } from "@/db/schema";
import { BackgroundManager } from "@/components/BackgroundManager";

export default async function BackgroundsPage() {
  const backgrounds = await db.select().from(imageBackgrounds).orderBy(asc(imageBackgrounds.name));
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">Hintergründe</h1>
        <p className="mt-0.5 flex items-start gap-1.5 text-sm text-zinc-500">
          <ImageIcon size={15} className="mt-0.5 shrink-0 text-zinc-400" />
          <span>
            Hintergrundfotos für das KI-Produktbild. Die KI setzt das erste DG-Produktbild auf einen dieser
            Hintergründe, verbessert Auflösung und Darstellung und wählt automatisch den passenden anhand von
            Foto, Beschreibung und Kategorie.
          </span>
        </p>
      </div>
      <BackgroundManager
        backgrounds={backgrounds.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description ?? "",
          categories: b.categories,
          imageUrl: b.imageUrl,
        }))}
      />
    </div>
  );
}
