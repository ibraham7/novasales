import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { validateMessageStep } from "@/modules/workflow/send/message-config";
import { MESSAGE_VARIABLES, renderMessage, wordingCount } from "@/modules/workflow/send/template";

const SAMPLE = { name: "أحمد علي", first_name: "أحمد", phone: "905321112233", stage: "عرض سعر", assignee: "مياسة", source: "إنستغرام", org: "شركتكم", value: "1,500 USD" };

/** What a new message/alert step starts with. */
export function defaultMessageConfig(action: string): Record<string, unknown> {
  if (action === "notify.staff") return { to: "assignee", title: "", body: "" };
  if (action === "message.email") return { kind: "service", subject: "", body: "" };
  return { kind: "service", account: "ticket", body: "" };
}

function VariableChips({ onPick }: { onPick: (variable: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(MESSAGE_VARIABLES).map(([key, label]) => (
        <button key={key} type="button" title={label} onClick={() => onPick(`{${key}}`)} className="rounded border bg-muted px-1.5 py-0.5 text-[11px] hover:bg-primary/10">
          {label}
        </button>
      ))}
    </div>
  );
}

/** The settings of a WhatsApp / email / staff-alert step as a form (no JSON). */
export function MessageStepForm({ action, config, onChange }: { action: string; config: Record<string, any>; onChange: (next: Record<string, unknown>) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const problem = useMemo(() => validateMessageStep(action, config), [action, config]);
  const isAlert = action === "notify.staff";
  const kind = config.kind === "promo" ? "promo" : "service";
  const bodyKey = "body";
  const preview = renderMessage(String(config[isAlert ? "title" : bodyKey] ?? ""), SAMPLE, () => 0);
  const append = (field: string, variable: string) => set({ [field]: `${String(config[field] ?? "")}${variable}` });

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      {isAlert ? (
        <>
          <div>
            <Label className="text-xs">من يصله التنبيه</Label>
            <Select value={config.to ?? "assignee"} onValueChange={(to) => set({ to })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="assignee">المندوب المسؤول عن التذكرة</SelectItem>
                <SelectItem value="managers">المديرون</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">عنوان التنبيه</Label>
            <Input value={config.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="مثال: تذكرة جديدة لك: {name}" />
            <VariableChips onPick={(v) => append("title", v)} />
          </div>
          <div>
            <Label className="text-xs">نص التنبيه (اختياري)</Label>
            <Textarea rows={2} value={config.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">نوع الرسالة</Label>
              <Select value={kind} onValueChange={(v) => set({ kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">خدمة (ردّ لمن راسلنا)</SelectItem>
                  <SelectItem value="promo">ترويجية (لمن وافق صراحةً فقط)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {action === "message.whatsapp" && (
              <div>
                <Label className="text-xs">الإرسال من رقم</Label>
                <Select value={config.account ?? "ticket"} onValueChange={(account) => set({ account })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ticket">محادثة التذكرة (الأفضل)</SelectItem>
                    <SelectItem value="owner">رقم المندوب المسؤول</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {action === "message.email" && (
            <div>
              <Label className="text-xs">موضوع الرسالة</Label>
              <Input value={config.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} />
            </div>
          )}
          <div>
            <Label className="text-xs">نص الرسالة</Label>
            <Textarea rows={5} value={config.body ?? ""} onChange={(e) => set({ body: e.target.value })} placeholder="{مرحباً|أهلاً} {first_name}، معك {assignee} من {org}…" />
            <VariableChips onPick={(v) => append("body", v)} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              الكلمات بين أقواس مثل <code dir="ltr">{"{مرحباً|أهلاً}"}</code> تُختار واحدة منها لكل عميل. ({wordingCount(String(config.body ?? ""))} صياغة ممكنة)
            </p>
          </div>
          {kind === "service" && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={config.allow_first_contact === true} onChange={(e) => set({ allow_first_contact: e.target.checked })} />
              أرسل حتى لو لم يراسلنا العميل من قبل (يتخطّاه النظام افتراضياً)
            </label>
          )}
          {kind === "promo" && <p className="text-[11px] text-amber-700">تُضاف في آخر الرسالة عبارة «لإيقاف الرسائل الترويجية ردّ بكلمة: إيقاف» تلقائياً، ولا تُرسل إلا لمن سُجّلت موافقته.</p>}
        </>
      )}
      {preview && (
        <div className="rounded border bg-background p-2 text-sm">
          <div className="mb-1 text-[11px] text-muted-foreground">معاينة ببيانات تجريبية</div>
          <div className="whitespace-pre-wrap">{preview}</div>
        </div>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
