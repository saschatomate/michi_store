import "server-only";

type PipelinePayload = {
  sourceProductId: number;
  modellErweitert: string;
};

export async function sendToPipelineWebhook(payload: PipelinePayload): Promise<void> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) {
    console.log(
      `[pipeline-webhook] N8N_WEBHOOK_URL nicht gesetzt – kein Aufruf für ${payload.modellErweitert} (Pipeline/n8n existiert in diesem Schritt noch nicht).`,
    );
    return;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`[pipeline-webhook] Aufruf fehlgeschlagen für ${payload.modellErweitert}:`, err);
  }
}
