import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wf-tick")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resumeRun } = await import("@/modules/workflow/executor.server");
        const db = supabaseAdmin as any;
        const nowIso = new Date().toISOString();
        const { data: jobs } = await db
          .from("wf_jobs")
          .select("*")
          .eq("status", "pending")
          .lte("resume_at", nowIso)
          .limit(200);
        let ok = 0, failed = 0;
        for (const j of (jobs ?? []) as any[]) {
          const { data: claimed } = await db
            .from("wf_jobs")
            .update({ status: "done", claimed_at: nowIso })
            .eq("id", j.id)
            .eq("status", "pending")
            .select("id")
            .maybeSingle();
          if (!claimed) continue;
          const target = j.wait_kind === "event" ? (j.timeout_step_id ?? j.resume_step_id) : j.resume_step_id;
          try {
            await resumeRun(j.run_id, target ?? null);
            ok++;
          } catch (e) {
            console.error("[wf-tick] resume failed", e);
            failed++;
          }
        }
        return Response.json({ processed: ok, failed });
      },
      GET: async () => new Response("ok"),
    },
  },
});
