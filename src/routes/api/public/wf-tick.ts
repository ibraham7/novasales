import { createFileRoute } from "@tanstack/react-router";
import { validTickToken } from "@/modules/workflow/definition";
export const Route = createFileRoute("/api/public/wf-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validTickToken(request.headers.get("authorization"), process.env.WORKFLOW_CRON_TOKEN))
          return Response.json({ error: "غير مصرح" }, { status: 401 });
        const { tickWorkflows } = await import("@/modules/workflow/jobs.server");
        try {
          return Response.json(await tickWorkflows());
        } catch {
          return Response.json({ error: "تعذر معالجة مهام الأتمتة" }, { status: 500 });
        }
      },
      GET: async () => new Response("Method not allowed", { status: 405 }),
    },
  },
});
