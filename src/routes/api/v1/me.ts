import { createFileRoute } from "@tanstack/react-router";
import { V1_CORS, authenticate, errorResponse, json } from "./_auth.server";

export const Route = createFileRoute("/api/v1/me")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: V1_CORS }),
      GET: async ({ request }) => {
        const auth = await authenticate(request, "self:read");
        if (auth instanceof Response) {
          // fallback: allow any valid key (no scope requirement) via re-verify
          const { verifyApiKey } = await import("@/modules/integrations/api-keys.server");
          const caller = await verifyApiKey(request.headers.get("authorization"));
          if (!caller) return errorResponse(401, "unauthorized", "Invalid API key");
          return json({ data: { organization_id: caller.organizationId, scopes: caller.scopes } });
        }
        return json({ data: { organization_id: auth.caller.organizationId, scopes: auth.caller.scopes } });
      },
    },
  },
});
