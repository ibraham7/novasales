import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";
import { getLegalInfoFn } from "@/modules/legal/legal.functions";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "شروط الاستخدام - NovaSales" }] }),
  loader: () => getLegalInfoFn(),
  component: function Page() {
    const info = Route.useLoaderData();
    return <LegalPage kind="terms" info={info} />;
  },
});
