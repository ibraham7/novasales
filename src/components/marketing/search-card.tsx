import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { getMarketingStatus, runProspectSearch } from "@/modules/marketing/marketing.functions";
import { MARKETING_COUNTRIES } from "@/modules/marketing/countries";
import { PLACES_PAGE_SIZE, estimateCostUsd, requestsFor } from "@/modules/marketing/search-input";
import { toast } from "@/lib/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass = "w-full rounded-md border bg-background p-2 text-sm";

/** The search form: what kind of business, where, and how many. Nothing is sent to anyone by searching. */
export function SearchCard({ onDone }: { onDone: (searchId: string) => void }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getMarketingStatus);
  const searchFn = useServerFn(runProspectSearch);
  const status = useQuery({ queryKey: ["marketing-status"], queryFn: () => statusFn(), staleTime: 30_000 });

  const [what, setWhat] = useState("");
  const [keywords, setKeywords] = useState("");
  const [country, setCountry] = useState("TR");
  const [city, setCity] = useState("");
  const [language, setLanguage] = useState("any");
  const [minRating, setMinRating] = useState(0);
  const [maxResults, setMaxResults] = useState(20);
  const [last, setLast] = useState<null | { found: number; created: number; updated: number; filteredOut: number; requests: number; estimatedCostUsd: number }>(null);

  const requests = requestsFor(maxResults);
  const price = status.data?.pricePer1000 ?? 35;
  const remaining = status.data ? status.data.monthlyCap - status.data.usedThisMonth : null;

  const run = useMutation({
    mutationFn: () =>
      searchFn({ data: { what, keywords: keywords || undefined, country: country as any, city: city || undefined, language: language as any, minRating, maxResults } }),
    onSuccess: (r) => {
      setLast(r);
      toast.success(`وجدنا ${r.kept} جهة، ${r.created} منها جديدة`);
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
      qc.invalidateQueries({ queryKey: ["marketing-status"] });
      onDone(r.searchId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">بحث عن جهات جديدة</h2>
        <p className="text-xs text-muted-foreground">يبحث في خرائط Google ويحفظ النتائج هنا للمراجعة. لا يُرسل أي رسالة بسبب البحث.</p>
      </div>

      {status.isSuccess && !status.data.configured && (
        <Alert variant="destructive">
          <AlertTitle>البحث غير مُعدّ بعد</AlertTitle>
          <AlertDescription>لم يُضبط مفتاح Google على الخادم (GOOGLE_PLACES_API_KEY). تواصل مع مدير النظام لإكمال الإعداد.</AlertDescription>
        </Alert>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="mk-what">نوع النشاط</Label>
          <Input id="mk-what" required minLength={2} maxLength={120} placeholder="مثال: عيادات أسنان، صيدليات، محلات ملابس" value={what} onChange={(e) => setWhat(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="mk-keywords">كلمات إضافية (اختياري)</Label>
          <Input id="mk-keywords" maxLength={120} placeholder="مثال: تقويم، جملة، عربي" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mk-country">الدولة</Label>
          <select id="mk-country" className={selectClass} value={country} onChange={(e) => setCountry(e.target.value)}>
            {MARKETING_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mk-city">المدينة أو المنطقة</Label>
          <Input id="mk-city" maxLength={80} placeholder="مثال: إسطنبول" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mk-language">لغة النتائج</Label>
          <select id="mk-language" className={selectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="any">غير مهم</option>
            <option value="ar">العربية</option>
            <option value="tr">التركية</option>
            <option value="en">الإنجليزية</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="mk-rating">أقل تقييم</Label>
            <select id="mk-rating" className={selectClass} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
              <option value={0}>الكل</option>
              {[3, 3.5, 4, 4.5].map((v) => (
                <option key={v} value={v}>
                  {v}+
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mk-max">عدد النتائج</Label>
            <select id="mk-max" className={selectClass} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))}>
              {[20, 40, 60].map((v) => (
                <option key={v} value={v}>
                  حتى {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={run.isPending || !what.trim() || !status.data?.configured || (remaining !== null && remaining < requests)}>
            {run.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Search className="ml-1 h-4 w-4" />}
            {run.isPending ? "جارٍ البحث..." : "ابحث"}
          </Button>
          <p className="text-xs text-muted-foreground">
            يستهلك البحث حتى {requests} طلب من Google (كل طلب حتى {PLACES_PAGE_SIZE} نتيجة)، بتكلفة تقديرية تقارب ${estimateCostUsd(requests, price)}. التسعير الفعلي من Google وقد يختلف.
            {status.data && ` استُعمل ${status.data.usedThisMonth} من ${status.data.monthlyCap} طلباً هذا الشهر.`}
          </p>
        </div>
      </form>

      {last && (
        <p className="rounded-md bg-muted p-2 text-sm">
          آخر بحث: {last.found} نتيجة من Google، {last.created} جديدة، {last.updated} موجودة سابقاً وتم تحديثها
          {last.filteredOut > 0 && `، و${last.filteredOut} استُبعدت لتقييمها`} · {last.requests} طلب (≈ ${last.estimatedCostUsd})
        </p>
      )}
    </Card>
  );
}
