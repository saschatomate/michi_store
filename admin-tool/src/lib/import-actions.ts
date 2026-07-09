"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/dal";
import { importCsvBuffer, type ImportResult } from "@/lib/csv-import";

export type UploadState = { result?: ImportResult; error?: string } | undefined;

export async function uploadCsv(_state: UploadState, formData: FormData): Promise<UploadState> {
  await requireAuth();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte eine CSV-Datei auswählen." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importCsvBuffer(buffer, file.name);

  revalidatePath("/import");
  revalidatePath("/");
  revalidatePath("/mapping");

  return { result };
}
