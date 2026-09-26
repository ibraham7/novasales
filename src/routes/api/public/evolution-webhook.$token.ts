import { createFileRoute } from "@tanstack/react-router";

// مسار توافق خلفي: الجلسات المربوطة قبل الويبهوك الموحّد ما زالت ترسل إلى هنا.
// المنطق كله يعيش في channel-events.server.ts (مشترك بين كل المحرّكات).

export const Route = createFileRoute("/api/public/evolution-webhook/$token")({
  server: {
    handlers: {
      POST: async (ctx: { request: Request; params: { token: string } }) => {
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
          await handleProviderWebhook("evolution", payload);
        } catch (e) {
          console.error("[WA_WEBHOOK:legacy] error", e, JSON.stringify(payload).slice(0, 2000));
        }
        return new Response("ok");
      },
      GET: async () => new Response("ok"),
    },
  },
});
