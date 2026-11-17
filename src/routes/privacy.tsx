import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";
import { getLegalInfoFn } from "@/modules/legal/legal.functions";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "سياسة الخصوصية - NovaSales" }] }),
  loader: () => getLegalInfoFn(),
  component: function Page() {
    const info = Route.useLoaderData();
    return <LegalPage kind="privacy" info={info} />;
  },
});
