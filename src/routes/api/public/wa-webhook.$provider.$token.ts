import { createFileRoute } from "@tanstack/react-router";

// ويبهوك موحّد لكل محرّكات واتساب: /api/public/wa-webhook/{provider}/{token}
// التوكن في المسار يوثّق المُتصل. التطبيع يتم داخل المزوّد نفسه.

export const Route = createFileRoute("/api/public/wa-webhook/$provider/$token")({
  server: {
    handlers: {
      POST: async (ctx: { request: Request; params: { provider: string; token: string } }) => {
        const expected = process.env.EVOLUTION_WEBHOOK_TOKEN;
        if (!expected || ctx.params.token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        let payload: unknown;
        try {
          payload = await ctx.request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const started = performance.now();
        try {
          const { handleProviderWebhook } = await import(
            "@/modules/channels/whatsapp/channel-events.server"
          );
          await handleProviderWebhook(ctx.params.provider, payload);
          logWebhookTiming(payload, performance.now() - started);
        } catch (e) {
          console.error(
            "[WA_WEBHOOK] error",
            e,
            "provider=",
            ctx.params.provider,
            "payload=",
            JSON.stringify(payload).slice(0, 2000),
          );
        }
        return new Response("ok");
      },
      GET: async () => new Response("ok"),
    },
  },
});

/**
 * Numbers only, no message content: how late WhatsApp delivered an incoming message
 * (its own timestamp to arrival) and how long we took to store it.
 */
function logWebhookTiming(payload: unknown, handledMs: number) {
  const body = payload as { event?: string; data?: { messageTimestamp?: number | string } } | null;
  const event = String(body?.event ?? "").toLowerCase();
  if (!event.includes("messages.upsert") && !event.includes("messages_upsert")) return;
  const sentAt = Number(body?.data?.messageTimestamp);
  const lagSeconds = Number.isFinite(sentAt) && sentAt > 0 ? Math.round(Date.now() / 1000 - sentAt) : null;
  console.log(`[WEBHOOK_TIMING] arrival_lag=${lagSeconds ?? "?"}s handled=${Math.round(handledMs)}ms`);
}
