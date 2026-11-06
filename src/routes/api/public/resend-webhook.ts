import { createFileRoute } from "@tanstack/react-router";

/** Delivery, bounce and complaint reports from Resend (signed with RESEND_WEBHOOK_SECRET). */
export const Route = createFileRoute("/api/public/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        const body = await request.text();
        const { verifyWebhookSignature, handleProviderEvent } = await import("@/modules/marketing/email-core");
        const valid = verifyWebhookSignature({
          secret: secret ?? "",
          id: request.headers.get("svix-id"),
          timestamp: request.headers.get("svix-timestamp"),
          signature: request.headers.get("svix-signature"),
          body,
        });
        if (!valid) return Response.json({ error: "غير مصرح" }, { status: 401 });
        try {
          const event = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
          if (typeof event.type === "string" && typeof event.data?.email_id === "string") {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await handleProviderEvent(supabaseAdmin as any, { type: event.type, providerMessageId: event.data.email_id });
          }
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[resend-webhook] failed", e instanceof Error ? e.message : e);
          return Response.json({ error: "تعذر المعالجة" }, { status: 500 });
        }
      },
      GET: async () => new Response("Method not allowed", { status: 405 }),
    },
  },
});
