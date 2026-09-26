import { createFileRoute } from "@tanstack/react-router";

/**
 * ويبهوك Meta الرسمي (Cloud API / Coexistence): /api/public/meta-webhook
 * - GET: تحقق ملكية الويبهوك (hub.challenge) بمقارنة META_VERIFY_TOKEN.
 * - POST: يجب أن يمرّ توقيع X-Hub-Signature-256 على الجسم الخام قبل أي معالجة.
 */
export const Route = createFileRoute("/api/public/meta-webhook")({
  server: {
    handlers: {
      GET: async (ctx: { request: Request }) => {
        const url = new URL(ctx.request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        const expected = process.env.META_VERIFY_TOKEN;
        if (mode === "subscribe" && expected && token === expected) {
          return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async (ctx: { request: Request }) => {
        const raw = await ctx.request.text();
        const { verifyMetaSignature } = await import("@/modules/channels/whatsapp/cloud-http");
        const ok = await verifyMetaSignature(raw, ctx.request.headers.get("x-hub-signature-256"));
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let payload: unknown;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        try {
          const { handleProviderWebhook } = await import(
            "@/modules/channels/whatsapp/channel-events.server"
          );
          const { COEXISTENCE_PROVIDER_ID } = await import(
            "@/modules/channels/whatsapp/coexistence.provider"
          );
          await handleProviderWebhook(COEXISTENCE_PROVIDER_ID, payload);
        } catch (e) {
          console.error("[META_WEBHOOK] error", e, JSON.stringify(payload).slice(0, 2000));
        }
        return new Response("ok");
      },
    },
  },
});
