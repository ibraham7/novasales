import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { SerenaChat } from "@/components/serena/serena-chat";

export const Route = createFileRoute("/_authenticated/serena")({
  head: () => ({ meta: [{ title: "سيرينا - NovaSales" }] }),
  component: SerenaPage,
});

function SerenaPage() {
  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto" dir="rtl">
      <Card className="p-4 lg:p-6">
        <SerenaChat />
      </Card>
    </div>
  );
}
