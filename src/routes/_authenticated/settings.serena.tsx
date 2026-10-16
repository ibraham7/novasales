import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSerenaSettings,
  listSerenaModels,
  saveSerenaSettings,
} from "@/modules/serena/serena.functions";

export const Route = createFileRoute("/_authenticated/settings/serena")({
  component: SerenaSettingsPage,
});

const NO_COST = "none";

function SerenaSettingsPage() {
  const qc = useQueryClient();
  const load = useServerFn(getSerenaSettings);
  const fetchModels = useServerFn(listSerenaModels);
  const save = useServerFn(saveSerenaSettings);
  const settingsQ = useQuery({ queryKey: ["serena-settings"], queryFn: () => load() });

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [costId, setCostId] = useState(NO_COST);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [numbers, setNumbers] = useState("");

  useEffect(() => {
    const data = settingsQ.data;
    if (!data) return;
    setModel(data.model ?? "");
    if (data.model)
      setModels((current) =>
        current.length ? current : [{ id: data.model!, label: data.model! }],
      );
    setCostId(data.costAttributeId ?? NO_COST);
    setWhatsappEnabled(data.whatsappEnabled);
    setNumbers(data.whatsappNumbers.join("\n"));
  }, [settingsQ.data]);

  const modelsMut = useMutation({
    mutationFn: () => fetchModels({ data: { apiKey: apiKey.trim() || undefined } }),
    onSuccess: ({ models: list }) => {
      setModels(list);
      if (!list.length) {
        toast.error("لا توجد موديلات محادثة متاحة لهذا المفتاح.");
        return;
      }
      // Keep the saved model if it is still offered, otherwise pick the first "flash" one.
      setModel((current) => (list.some((item) => item.id === current) ? current : list[0].id));
      toast.success("تم التحقق من المفتاح");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      save({
        data: {
          apiKey: apiKey.trim() || undefined,
          model,
          costAttributeId: costId === NO_COST ? null : costId,
          whatsappEnabled,
          whatsappNumbers: numbers
            .split(/[\n,،]+/)
            .map((number) => number.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("تم حفظ إعدادات سيرينا");
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["serena-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = settingsQ.data;
  return (
    <Card className="p-6" dir="rtl">
      <h2 className="text-lg font-semibold mb-1">سيرينا — المساعدة الذكية</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
        سيرينا تقرأ المبيعات والمخزون والأرباح ومحادثات الزباين على واتساب، وتقترح شو تجيب بضاعة
        وكيف تحسّن الربح. اختر مزوّد الذكاء الاصطناعي وأدخل مفتاحه.
      </p>
      {settingsQ.isError && (
        <p className="text-sm text-destructive mb-4">{(settingsQ.error as Error).message}</p>
      )}

      <div className="space-y-6 max-w-xl">
        <div className="space-y-2">
          <Label>مزوّد الذكاء الاصطناعي</Label>
          <Select value="google" disabled>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google">Google (Gemini)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="serena-key">مفتاح Google API</Label>
          <Input
            id="serena-key"
            type="password"
            dir="ltr"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              data?.apiKeyHint
                ? `محفوظ: ••••${data.apiKeyHint} (اتركه فارغًا للإبقاء عليه)`
                : "AIza…"
            }
          />
          <p className="text-xs text-muted-foreground flex gap-1 items-start">
            <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            يُحفظ المفتاح مشفّرًا ولا يظهر مرة أخرى. أنشئه من Google AI Studio (aistudio.google.com
            ← Get API key). لا ترسله في المحادثات.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={modelsMut.isPending || (!apiKey.trim() && !data?.apiKeyHint)}
            onClick={() => modelsMut.mutate()}
          >
            {modelsMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} تحقق من المفتاح
            واجلب الموديلات
          </Button>
        </div>

        <div className="space-y-2">
          <Label>الموديل</Label>
          <Select value={model || undefined} onValueChange={setModel} disabled={!models.length}>
            <SelectTrigger>
              <SelectValue placeholder="تحقق من المفتاح أولًا" />
            </SelectTrigger>
            <SelectContent>
              {models.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                  {/flash/i.test(item.id) ? " ⚡" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            يُفضَّل موديل فيه كلمة Flash: سريع وتكلفته أقل.
          </p>
        </div>

        <div className="space-y-2">
          <Label>خاصية سعر التكلفة (لحساب الربح)</Label>
          <Select value={costId} onValueChange={setCostId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COST}>بدون — لن تحسب سيرينا الأرباح</SelectItem>
              {data?.moneyProperties.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                  {property.scope === "variant" ? " (لكل نوع)" : ""}
                  {property.is_price_floor ? " — الحد الأدنى للبيع" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            أضف خاصية من نوع «مبلغ» باسم «سعر التكلفة» من صفحة المنتجات ← الخصائص، واملأها لكل منتج،
            ثم اخترها هنا.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="serena-wa">محادثة سيرينا على واتساب</Label>
              <p className="text-xs text-muted-foreground mt-1">
                الأرقام التالية فقط تستطيع مراسلة أي رقم واتساب للشركة، فترد عليها سيرينا بدل أن
                تدخل كعميل.
              </p>
            </div>
            <Switch id="serena-wa" checked={whatsappEnabled} onCheckedChange={setWhatsappEnabled} />
          </div>
          <Textarea
            dir="ltr"
            rows={3}
            value={numbers}
            onChange={(event) => setNumbers(event.target.value)}
            placeholder={"905xxxxxxxxx\n9665xxxxxxxx"}
            aria-label="أرقام مسموح لها"
          />
          <p className="text-xs text-muted-foreground">
            رقم في كل سطر مع رمز الدولة. ضع أرقام صاحب الشركة والمدراء فقط، لا أرقام زبائن.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          الخصوصية: عند السؤال تُرسل لسيرينا أرقام المبيعات ونصوص رسائل الزباين بعد حذف الأرقام
          والإيميلات منها إلى Google. في الخطة المجانية من Google قد تُستخدم البيانات لتحسين
          خدماتهم؛ فعّل الدفع (Billing) في Google AI Studio لتجنّب ذلك.
        </p>

        <Button validate onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !model}>
          {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} حفظ
        </Button>
      </div>
    </Card>
  );
}
