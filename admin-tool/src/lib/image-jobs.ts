import "server-only";
import { after } from "next/server";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { imageJobs, sourceProducts } from "@/db/schema";
import { generateEnhancedShot } from "@/lib/enhanced-shot";

const CONCURRENCY = 3;
// Ein Auftrag, der so lange "läuft", ist abgebrochen (Server beendet, Zeitlimit) - sonst bliebe er ewig offen.
const STALE_AFTER_MINUTES = 15;

export async function failStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
  await db
    .update(imageJobs)
    .set({ status: "failed", error: "Zeitüberschreitung - Auftrag wurde nicht beendet.", finishedAt: new Date() })
    .where(and(inArray(imageJobs.status, ["queued", "running"]), lt(imageJobs.createdAt, cutoff)));
}

// Legt Aufträge an (Produkte mit offenem Auftrag werden übersprungen) und startet die Abarbeitung nach der
// Antwort an den Browser. Gibt zurück, wie viele neu eingereiht wurden.
export async function enqueueEnhancedShots(
  productIds: number[],
  backgroundId: number | null,
  distance: string | null = null,
): Promise<number> {
  await failStaleJobs();
  const open = await db
    .select({ id: imageJobs.sourceProductId })
    .from(imageJobs)
    .where(and(inArray(imageJobs.sourceProductId, productIds), inArray(imageJobs.status, ["queued", "running"])));
  const busy = new Set(open.map((o) => o.id));
  const toQueue = productIds.filter((id) => !busy.has(id));
  if (toQueue.length === 0) return 0;

  const jobs = await db
    .insert(imageJobs)
    .values(toQueue.map((sourceProductId) => ({ sourceProductId, backgroundId, distance })))
    .returning({ id: imageJobs.id });

  const queue = jobs.map((j) => j.id);
  after(async () => {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) await runJob(id);
      }),
    );
  });
  return toQueue.length;
}

async function runJob(jobId: number): Promise<void> {
  const job = await db.query.imageJobs.findFirst({ where: eq(imageJobs.id, jobId) });
  if (!job || job.status !== "queued") return;
  await db.update(imageJobs).set({ status: "running", startedAt: new Date() }).where(eq(imageJobs.id, jobId));
  try {
    const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, job.sourceProductId) });
    if (!product) throw new Error("Artikel nicht gefunden.");
    await generateEnhancedShot(product, job.backgroundId, job.distance);
    await db.update(imageJobs).set({ status: "done", finishedAt: new Date() }).where(eq(imageJobs.id, jobId));
  } catch (err) {
    await db
      .update(imageJobs)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() })
      .where(eq(imageJobs.id, jobId));
  }
}

export async function imageJobCounts(): Promise<{ active: number; recentDone: number; recentFailed: number }> {
  await failStaleJobs();
  const since = new Date(Date.now() - 10 * 60_000);
  const rows = await db
    .select({
      active: sql<number>`count(*) filter (where ${imageJobs.status} in ('queued','running'))::int`,
      recentDone: sql<number>`count(*) filter (where ${imageJobs.status} = 'done' and ${imageJobs.finishedAt} > ${since})::int`,
      recentFailed: sql<number>`count(*) filter (where ${imageJobs.status} = 'failed' and ${imageJobs.finishedAt} > ${since})::int`,
    })
    .from(imageJobs);
  return rows[0];
}

export async function activeJobForProduct(productId: number): Promise<{ status: string; startedAt: Date | null } | null> {
  await failStaleJobs();
  const row = await db.query.imageJobs.findFirst({
    where: and(eq(imageJobs.sourceProductId, productId), or(eq(imageJobs.status, "queued"), eq(imageJobs.status, "running"))),
  });
  return row ? { status: row.status, startedAt: row.startedAt } : null;
}
