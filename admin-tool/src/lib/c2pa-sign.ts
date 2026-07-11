import "server-only";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signAiGeneratedMedia, resolveDigitalSourceType } from "sign-ai-media";

// AI-Act-Kennzeichnung: C2PA-Metadaten (keine sichtbare Bildmarkierung, bewusste Nutzer-Entscheidung).
// Nutzt die gebündelten Test-Credentials von sign-ai-media (kein eigenes Zertifikat für diesen
// Schritt) - für eine produktions-vertrauenswürdige Signatur wäre später ein CA-Zertifikat nötig.
export async function signGeneratedImage(imageBuffer: Buffer, prompt: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "marinell-c2pa-"));
  const inputPath = join(dir, "input.png");
  const outputPath = join(dir, "output.png");

  try {
    await writeFile(inputPath, imageBuffer);

    await signAiGeneratedMedia({
      input: inputPath,
      output: outputPath,
      metadata: {
        softwareAgent: "Marinell Admin-Tool Bildgenerierung",
        generator: "OpenAI GPT Image API (gpt-image-1.5)",
        model: "gpt-image-1.5",
        producer: "Marinell",
        prompt,
        digitalSourceType: resolveDigitalSourceType("ai-edited"),
        actionDescription: "Echtes Produktfoto mit KI-generierter Umgebung kompositiert",
      },
    });

    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
