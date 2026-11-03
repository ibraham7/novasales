import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Target } from "lucide-react";
import { ProspectsPanel } from "@/components/marketing/prospects-panel";
import { SearchCard } from "@/components/marketing/search-card";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({ meta: [{ title: "التسويق - NovaSales" }] }),
  component: MarketingPage,
});

function MarketingPage() {
  const [focusSearchId, setFocusSearchId] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6" dir="rtl">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Target className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">التسويق</h1>
          <p className="text-sm text-muted-foreground">اكتشف جهات جديدة، راجعها واعتمد من تريد التواصل معه. لا يُرسل شيء قبل اعتمادك.</p>
        </div>
      </div>
      <SearchCard onDone={setFocusSearchId} />
      <ProspectsPanel focusSearchId={focusSearchId} />
    </div>
  );
}
