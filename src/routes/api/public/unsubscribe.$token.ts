import { createFileRoute } from "@tanstack/react-router";

/**
 * The address in an email's List-Unsubscribe header. Mailbox providers POST here for one-click
 * unsubscribe; a person who opens it in a browser is sent to the confirmation page instead.
 */
export const Route = createFileRoute("/api/public/unsubscribe/$token")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        if (!/^[\w-]{20,40}$/.test(params.token)) return new Response("Bad token", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { handleEmailStop } = await import("@/modules/marketing/email-core");
        const result = await handleEmailStop(supabaseAdmin as any, params.token);
        return result.ok ? new Response("OK", { status: 200 }) : new Response("Not found", { status: 404 });
      },
      GET: async ({ params }) => new Response(null, { status: 302, headers: { Location: `/stop/${encodeURIComponent(params.token)}` } }),
    },
  },
});
