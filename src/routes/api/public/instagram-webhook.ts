import { createFileRoute } from "@tanstack/react-router";

/**
 * Instagram webhook: /api/public/instagram-webhook
 * - GET: Meta's ownership check (hub.challenge) against INSTAGRAM_VERIFY_TOKEN.
 * - POST: the X-Hub-Signature-256 over the raw body must match INSTAGRAM_APP_SECRET before anything is read.
 * Each message goes to the organization that linked the account it was sent to, and only to it.
 * It is separate from the WhatsApp webhook so nothing here can affect WhatsApp.
 */
export const Route = createFileRoute("/api/public/instagram-webhook")({
  server: {
    handlers: {
      GET: async (ctx: { request: Request }) => {
        const url = new URL(ctx.request.url);
        const expected = process.env.INSTAGRAM_VERIFY_TOKEN;
        if (url.searchParams.get("hub.mode") === "subscribe" && expected && url.searchParams.get("hub.verify_token") === expected) {
          return new Response(url.searchParams.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async (ctx: { request: Request }) => {
        const raw = await ctx.request.text();
        const core = await import("@/modules/channels/instagram/instagram-core");
        const valid = await core.verifyHubSignature(raw, ctx.request.headers.get("x-hub-signature-256"), process.env.INSTAGRAM_APP_SECRET);
        if (!valid) return new Response("Invalid signature", { status: 401 });
        let payload: unknown;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        try {
          const events = core.parseInstagramWebhook(payload);
          if (events.length) {
            const [{ supabaseAdmin }, store, server, whatsappEvents] = await Promise.all([
              import("@/integrations/supabase/client.server"),
              import("@/modules/channels/instagram/instagram-store"),
              import("@/modules/channels/instagram/instagram.server"),
              import("@/modules/channels/whatsapp/channel-events.server"),
            ]);
            const db = supabaseAdmin as any;
            await store.handleInstagramEvents(db, server.instagramDeps(), events, {
              // The same step that gives a WhatsApp chat its deal, with Instagram's own labels.
              onInbound: (c) =>
                whatsappEvents.ensureOpportunity(
                  db,
                  { accountId: c.accountId, orgId: c.organizationId, ownerUserId: c.ownerUserId, externalRef: "", providerId: core.INSTAGRAM_PROVIDER_ID },
                  { phone: c.customerId, sessionId: c.sessionId, fromMe: c.fromMe, channelType: "instagram", source: "instagram_inbound", sourceLabel: "إنستغرام" },
                ),
            });
          }
        } catch (error) {
          console.error("[INSTAGRAM_WEBHOOK] error", error instanceof Error ? error.message : error);
        }
        // Meta only needs to know it arrived; a failure above must not make it resend forever.
        return new Response("ok");
      },
    },
  },
});
