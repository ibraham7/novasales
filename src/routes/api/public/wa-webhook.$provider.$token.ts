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
        try {
          const { handleProviderWebhook } = await import(
            "@/modules/channels/whatsapp/channel-events.server"
          );
          await handleProviderWebhook(ctx.params.provider, payload);
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
