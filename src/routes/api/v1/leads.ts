import { createFileRoute } from "@tanstack/react-router";
import { V1_CORS, authenticate, errorResponse, json, logRequest } from "./_auth.server";

export const Route = createFileRoute("/api/v1/leads")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: V1_CORS }),
      GET: async ({ request }) => {
        const started = Date.now();
        const auth = await authenticate(request, "leads:read");
        if (auth instanceof Response) return auth;
        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
        const status = url.searchParams.get("status");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          let q = db
            .from("crm_leads")
            .select("id, contact_id, department_id, owner_user_id, source, status, score, notes, opened_at, converted_at, created_at, updated_at", { count: "exact" })
            .eq("organization_id", auth.caller.organizationId)
            .order("opened_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (status) q = q.eq("status", status);
          const { data, count, error } = await q;
          if (error) throw new Error(error.message);
          const res = json({ data: data ?? [], pagination: { limit, offset, total: count ?? 0 } });
          await logRequest(auth.caller, request, 200, Date.now() - started);
          return res;
        } catch (e) {
          await logRequest(auth.caller, request, 500, Date.now() - started);
          return errorResponse(500, "internal_error", (e as Error).message);
        }
      },
      POST: async ({ request }) => {
        const started = Date.now();
        const auth = await authenticate(request, "leads:write");
        if (auth instanceof Response) return auth;
        try {
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object") return errorResponse(400, "bad_request", "Invalid JSON body");
          const { z } = await import("zod");
          const parsed = z.object({
            contactName: z.string().min(1).max(200),
            phone: z.string().max(50).optional(),
            email: z.string().email().max(200).optional(),
            departmentId: z.string().uuid().optional(),
            source: z.string().max(100).optional(),
            notes: z.string().max(2000).optional(),
          }).safeParse(body);
          if (!parsed.success) return errorResponse(400, "validation_error", parsed.error.message);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: contact, error: cErr } = await db.from("crm_contacts").insert({
            organization_id: auth.caller.organizationId,
            display_name: parsed.data.contactName,
            full_name: parsed.data.contactName,
            primary_department_id: parsed.data.departmentId ?? null,
            lifecycle_stage: "lead",
          }).select("id").single();
          if (cErr) throw new Error(cErr.message);
          const { data: lead, error: lErr } = await db.from("crm_leads").insert({
            organization_id: auth.caller.organizationId,
            contact_id: contact.id,
            department_id: parsed.data.departmentId ?? null,
            source: parsed.data.source ?? "api",
            status: "new",
            notes: parsed.data.notes,
          }).select("*").single();
          if (lErr) throw new Error(lErr.message);
          // Publish domain event → triggers webhooks and workflows
          try {
            const { publishEvent } = await import("@/platform/events/bus.server");
            await publishEvent({
              type: "lead.created",
              organizationId: auth.caller.organizationId,
              aggregateType: "lead",
              aggregateId: lead.id,
              payload: { lead, contact },
            });
          } catch (e) { console.error("[api/v1/leads] publishEvent failed", e); }
          const res = json({ data: lead }, { status: 201 });
          await logRequest(auth.caller, request, 201, Date.now() - started);
          return res;
        } catch (e) {
          await logRequest(auth.caller, request, 500, Date.now() - started);
          return errorResponse(500, "internal_error", (e as Error).message);
        }
      },
    },
  },
});
