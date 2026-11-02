import { createFileRoute } from "@tanstack/react-router";
import { createRateLimiter } from "@/modules/notifications/rate-limit";

const limiter = createRateLimiter(120, 60_000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The device reports that it showed (or the person clicked) a notification. The id is the random
 * id of one notification inside the payload; the call can only stamp a time on that row.
 */
export const Route = createFileRoute("/api/public/push-receipt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        if (!limiter.allow(ip)) return new Response(null, { status: 429 });
        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response(null, { status: 400 });
        }
        const id = String(body?.id ?? "");
        const event = body?.event;
        if (!UUID.test(id) || (event !== "shown" && event !== "clicked")) return new Response(null, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const column = event === "shown" ? "shown_at" : "clicked_at";
        await (supabaseAdmin as any).from("push_messages").update({ [column]: new Date().toISOString() }).eq("id", id).is(column, null);
        return new Response(null, { status: 204 });
      },
      GET: async () => new Response("Method not allowed", { status: 405 }),
    },
  },
});
