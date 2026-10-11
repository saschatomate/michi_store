import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { resyncChangedProducts } from "@/lib/shopify-sync";

// Läuft nach dem Diamond-Group-Sync (siehe vercel.json): zieht alle Produkte, die schon in Shopify
// liegen und sich seit der letzten Übertragung geändert haben, nach (Preis, Texte, Lieferzeit bei
// geändertem Lagerbestand, Kategorien, Bilder, ausgelistet -> archiviert). Eigene Route statt
// Anhängsel des DG-Syncs, damit beide ihr eigenes Zeitlimit haben.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await resyncChangedProducts();

  revalidatePath("/");
  revalidatePath("/mapping");

  return NextResponse.json(summary);
}
