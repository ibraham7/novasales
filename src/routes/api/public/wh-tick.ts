import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wh-tick")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { tickWebhooks } = await import("@/modules/integrations/webhooks.server");
          const r = await tickWebhooks();
          return Response.json(r);
        } catch (e) {
          console.error("[wh-tick] failed", e);
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () => new Response("ok"),
    },
  },
});
