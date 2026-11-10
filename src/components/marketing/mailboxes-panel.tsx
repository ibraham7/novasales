import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { deleteMailboxFn, saveMailboxFn } from "@/modules/marketing/outbound.functions";
import { MAILBOX_PRESETS } from "@/modules/marketing/mailbox-presets";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MailboxRow = { id: string; label: string; fromEmail: string; status: string; dailyLimit: number; lastError: string | null };

const empty = { preset: "", label: "", fromEmail: "", fromName: "", smtpHost: "", smtpPort: 465, smtpSecurity: "ssl" as "ssl" | "starttls" | "none", smtpUser: "", smtpPass: "", dailyLimit: 50 };

function AddMailboxDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveMailboxFn);
  const [f, setF] = useState(empty);
  const set = (patch: Partial<typeof empty>) => setF((v) => ({ ...v, ...patch }));
  const pick = (key: string) => {
    const p = MAILBOX_PRESETS[key];
    set(p ? { preset: key, smtpHost: p.host, smtpPort: p.port, smtpSecurity: p.security } : { preset: "" });
  };
  const save = useMutation({
    mutationFn: () => saveFn({ data: { label: f.label, fromEmail: f.fromEmail, fromName: f.fromName || null, smtpHost: f.smtpHost, smtpPort: f.smtpPort, smtpSecurity: f.smtpSecurity, smtpUser: f.smtpUser || f.fromEmail, smtpPass: f.smtpPass, dailyLimit: f.dailyLimit } }),
    onSuccess: () => {
      toast.success("تم الاتصال بالصندوق وحُفظ");
      qc.invalidateQueries({ queryKey: ["email-status"] });
      setF(empty);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const note = MAILBOX_PRESETS[f.preset]?.note;
  const ready = f.label.trim() && f.fromEmail.includes("@") && f.smtpHost && f.smtpPass;

  return (
    <Dialog open={open} onOpenChange={(v) => !save.isPending && onOpenChange(v)}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ربط صندوق بريد</DialogTitle>
          <DialogDescription>تُرسل الحملات من هذا الصندوق باسم مؤسستك. نختبر الاتصال قبل الحفظ، وتُخزَّن كلمة السر مشفّرة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mb-preset">مزوّد البريد</Label>
            <select id="mb-preset" className="w-full rounded-md border bg-background p-2 text-sm" value={f.preset} onChange={(e) => pick(e.target.value)}>
              <option value="">مخصّص (أدخل الإعدادات يدوياً)</option>
              {Object.entries(MAILBOX_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
            {note && <p className="text-xs text-amber-600">{note}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mb-label">اسم الصندوق (لك)</Label>
              <Input id="mb-label" value={f.label} maxLength={100} onChange={(e) => set({ label: e.target.value })} placeholder="مثال: المبيعات" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-name">اسم المرسِل الظاهر</Label>
              <Input id="mb-name" value={f.fromName} maxLength={100} onChange={(e) => set({ fromName: e.target.value })} placeholder="مثال: شركة نوفا" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-email">عنوان البريد</Label>
              <Input id="mb-email" dir="ltr" value={f.fromEmail} onChange={(e) => set({ fromEmail: e.target.value, smtpUser: f.smtpUser || e.target.value })} placeholder="sales@company.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-user">اسم المستخدم</Label>
              <Input id="mb-user" dir="ltr" value={f.smtpUser} onChange={(e) => set({ smtpUser: e.target.value })} placeholder="غالباً نفس البريد" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-host">خادم SMTP</Label>
              <Input id="mb-host" dir="ltr" value={f.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} placeholder="smtp.company.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-port">المنفذ والتشفير</Label>
              <div className="flex gap-2">
                <Input id="mb-port" dir="ltr" type="number" className="w-24" value={f.smtpPort} onChange={(e) => set({ smtpPort: Number(e.target.value) })} />
                <select className="flex-1 rounded-md border bg-background p-2 text-sm" value={f.smtpSecurity} onChange={(e) => set({ smtpSecurity: e.target.value as typeof f.smtpSecurity })}>
                  <option value="ssl">SSL (465)</option>
                  <option value="starttls">STARTTLS (587)</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-pass">كلمة السر</Label>
              <Input id="mb-pass" dir="ltr" type="password" autoComplete="new-password" value={f.smtpPass} onChange={(e) => set({ smtpPass: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-limit">الحد اليومي</Label>
              <Input id="mb-limit" type="number" min={1} max={2000} value={f.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">ابدأ بعدد صغير (30–50) لحماية سمعة نطاقك.</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} اختبار وحفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The organization's own mailboxes: campaigns are sent from these, never from anyone else's. */
export function MailboxesPanel({ mailboxes, encryptionReady, canManage }: { mailboxes: MailboxRow[]; encryptionReady: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const deleteFn = useServerFn(deleteMailboxFn);
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("حُذف الصندوق");
      qc.invalidateQueries({ queryKey: ["email-status"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">صناديق البريد</p>
          <p className="text-xs text-muted-foreground">كل مؤسسة ترسل من صندوقها وبنطاقها الخاص.</p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!encryptionReady}>
            <Plus className="ml-1 h-4 w-4" /> ربط صندوق
          </Button>
        )}
      </div>
      {!encryptionReady && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>مفتاح التشفير غير مضبوط</AlertTitle>
          <AlertDescription>أضف MAILBOX_ENCRYPTION_KEY إلى إعدادات الخادم (نص عشوائي طويل) ثم أعد تشغيله قبل ربط أي صندوق.</AlertDescription>
        </Alert>
      )}
      {mailboxes.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-4 w-4" /> لا يوجد صندوق بعد.</p>
      ) : (
        mailboxes.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <div>
              <span className="font-medium">{m.label}</span> <span dir="ltr" className="text-xs text-muted-foreground">{m.fromEmail}</span>
              <p className="text-xs text-muted-foreground">حتى {m.dailyLimit} إيميل يومياً</p>
              {m.lastError && <p className="text-xs text-destructive">{m.lastError}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={m.status === "active" ? "secondary" : "destructive"}>{m.status === "active" ? "يعمل" : m.status === "error" ? "خطأ بالدخول" : "معطّل"}</Badge>
              {canManage && (
                <Button size="icon" variant="ghost" disabled={remove.isPending} onClick={async () => (await askConfirm({ title: "حذف الصندوق؟", description: "لن تتمكن الحملات الجديدة من استخدامه.", confirmLabel: "حذف", destructive: true })) && remove.mutate(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))
      )}
      <AddMailboxDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
