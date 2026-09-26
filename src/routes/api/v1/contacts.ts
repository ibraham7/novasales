import { createFileRoute } from "@tanstack/react-router";
import { V1_CORS, authenticate, errorResponse, json, logRequest } from "./_auth.server";

export const Route = createFileRoute("/api/v1/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: V1_CORS }),
      GET: async ({ request }) => {
        const started = Date.now();
        const auth = await authenticate(request, "contacts:read");
        if (auth instanceof Response) return auth;
        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, count, error } = await (supabaseAdmin as any)
            .from("crm_contacts")
            .select("*", { count: "exact" })
            .eq("organization_id", auth.caller.organizationId)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) throw new Error(error.message);
          const res = json({ data: data ?? [], pagination: { limit, offset, total: count ?? 0 } });
          await logRequest(auth.caller, request, 200, Date.now() - started);
          return res;
        } catch (e) {
          await logRequest(auth.caller, request, 500, Date.now() - started);
          return errorResponse(500, "internal_error", (e as Error).message);
        }
      },
    },
  },
});
