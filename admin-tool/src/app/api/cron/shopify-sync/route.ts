import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { resyncStockLevels } from "@/lib/shopify-sync";

// Läuft nach dem Diamond-Group-Sync (siehe vercel.json): überträgt nur geänderte Stückzahlen nach
// Shopify (Preis, Texte, Bilder und Live/Entwurf-Status bleiben unberührt). Eigene Route statt
// Anhängsel des DG-Syncs, damit beide ihr eigenes Zeitlimit haben.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await resyncStockLevels();

  revalidatePath("/");
  revalidatePath("/mapping");

  return NextResponse.json(summary);
}
