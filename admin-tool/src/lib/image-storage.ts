import "server-only";
import { StorageClient } from "@supabase/storage-js";

const BUCKET = "product-images";

// Nutzt @supabase/storage-js direkt statt des vollen @supabase/supabase-js-Clients: der volle
// Client initialisiert immer auch einen Realtime-Client, der unter Node < 22 ohne natives
// WebSocket sofort einen Fehler wirft - wir brauchen hier ausschließlich Storage.
function storageClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sind nicht gesetzt (.env.local prüfen).");
  }
  return new StorageClient(`${url}/storage/v1`, {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  });
}

export async function uploadGeneratedImage(
  buffer: Buffer,
  path: string,
): Promise<{ url: string; path: string }> {
  const storage = storageClient();
  const { error } = await storage.from(BUCKET).upload(path, buffer, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) {
    throw new Error(`Upload nach Supabase Storage fehlgeschlagen: ${error.message}`);
  }

  const { data } = storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function deleteGeneratedImage(path: string): Promise<void> {
  const storage = storageClient();
  await storage.from(BUCKET).remove([path]);
}

// Direkt-Upload vom Browser (Originalqualität, kein Umweg über den Server-Action-Body, der bei
// 1 MB bzw. auf Vercel bei 4,5 MB endet): der Server erzeugt nur eine signierte Upload-URL, der
// Browser lädt die Datei selbst dorthin hoch. Wird für selbst hochgeladene Produktbilder genutzt.
export async function createSignedImageUpload(path: string): Promise<{ signedUrl: string; path: string }> {
  const { data, error } = await storageClient().from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Signierte Upload-URL konnte nicht erzeugt werden: ${error?.message ?? "unbekannter Fehler"}`);
  }
  return { signedUrl: data.signedUrl, path: data.path };
}

export function publicImageUrl(path: string): string {
  return storageClient().from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function removeStoredImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await storageClient().from(BUCKET).remove(paths);
}
