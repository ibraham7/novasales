import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Target } from "lucide-react";
import { CampaignWizard } from "@/components/marketing/campaign-wizard";
import { CampaignsTab } from "@/components/marketing/campaigns-tab";
import { ManualProspectDialog } from "@/components/marketing/manual-prospect-dialog";
import { ProspectsPanel } from "@/components/marketing/prospects-panel";
import { SearchCard } from "@/components/marketing/search-card";
import { SettingsTab } from "@/components/marketing/settings-tab";
import { SuppressionsTab } from "@/components/marketing/suppressions-tab";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({ meta: [{ title: "التسويق - NovaSales" }] }),
  component: MarketingPage,
});

function MarketingPage() {
  const [tab, setTab] = useState("discover");
  const [focusSearchId, setFocusSearchId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6" dir="rtl">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Target className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">التسويق</h1>
          <p className="text-sm text-muted-foreground">اكتشف جهات جديدة، راجعها واعتمد من تريد التواصل معه. لا يُرسل شيء قبل اعتمادك.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="discover">اكتشاف العملاء</TabsTrigger>
          <TabsTrigger value="campaigns">الحملات</TabsTrigger>
          <TabsTrigger value="suppressions">لا ترسل</TabsTrigger>
          <TabsTrigger value="settings">الإعدادات</TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="space-y-5">
          <SearchCard onDone={setFocusSearchId} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}>
              <Plus className="ml-1 h-4 w-4" /> إضافة جهة يدوياً
            </Button>
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              إنشاء حملة من المعتمدين
            </Button>
          </div>
          <ProspectsPanel focusSearchId={focusSearchId} />
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignsTab onNew={() => setWizardOpen(true)} />
        </TabsContent>
        <TabsContent value="suppressions">
          <SuppressionsTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      </Tabs>

      <ManualProspectDialog open={manualOpen} onOpenChange={setManualOpen} />
      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} onDone={() => setTab("campaigns")} />
    </div>
  );
}
