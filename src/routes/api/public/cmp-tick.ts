import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cmp-tick")({
  server: {
    handlers: {
      POST: async () => {
        const { tickCampaigns } = await import("@/modules/campaigns/dispatcher.server");
        try {
          const r = await tickCampaigns();
          return Response.json(r);
        } catch (e) {
          console.error("[cmp-tick] failed", e);
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () => new Response("ok"),
    },
  },
});
