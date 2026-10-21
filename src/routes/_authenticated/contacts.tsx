import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listContacts, upsertContact, deleteContact, funnelStages } from "@/modules/crm";
import { listInstances } from "@/modules/channels";
import { createChatFromContact } from "@/modules/messaging";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { matchesSearch } from "@/lib/fuzzy-search";
import { Plus, Trash2, MessageSquare, User } from "lucide-react";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "جهات الاتصال - NovaSales" },
      { name: "description", content: "أدر جهات اتصالك ومراحل قمع المبيعات." },
      { property: "og:title", content: "جهات الاتصال - NovaSales" },
      { property: "og:description", content: "أدر جهات اتصالك ومراحل قمع المبيعات." },
    ],
  }),
  component: Contacts,
});

const STAGE_LABEL: Record<string, string> = {
  lead: "عميل محتمل",
  qualified: "مؤهل",
  customer: "عميل",
  returning_customer: "عميل متكرر",
  churned: "منسحب",
};

function Contacts() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchList = useServerFn(listContacts);
  const fetchInstances = useServerFn(listInstances);
  const save = useServerFn(upsertContact);
  const del = useServerFn(deleteContact);
  const createChat = useServerFn(createChatFromContact);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", debounced],
    queryFn: () => fetchList({ data: { search: debounced || undefined } }),
    placeholderData: (prev: any) => prev,
  });
  const { data: instances = [] } = useQuery({ queryKey: ["instances"], queryFn: () => fetchInstances() });

  const visible = debounced
    ? contacts
    : contacts.filter((c: any) => matchesSearch(search, [c.name, c.phone, c.notes]));

  const [form, setForm] = useState({ id: "", phone: "", name: "", funnel_stage: "lead", notes: "" });

  const saveMut = useMutation({
    mutationFn: () => save({
      data: {
        id: form.id || undefined,
        phone: form.phone,
        name: form.name || null,
        funnel_stage: form.funnel_stage as typeof funnelStages[number],
        notes: form.notes || null,
      },
    }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setOpen(false);
      setForm({ id: "", phone: "", name: "", funnel_stage: "lead", notes: "" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  const chatMut = useMutation({
    mutationFn: (contactId: string) => {
      const instance = instances.find((i: { status: string }) => i.status === "connected") ?? instances[0];
      if (!instance) throw new Error("لا توجد جلسة واتساب متاحة");
      return createChat({ data: { contactId, instanceId: instance.id } });
    },
    onSuccess: (chat) => {
      navigate({ to: "/chat/$chatId", params: { chatId: chat.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl">
      {/* On a phone the title sits above a full-width search and the add button, so nothing runs
          off the screen; from sm up they share one row as before. */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">جهات الاتصال</h1>
          <p className="text-muted-foreground mt-1">{visible.length} من {contacts.length} جهة اتصال</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
        <Input
          className="flex-1 min-w-0 sm:w-56 sm:flex-none"
          placeholder="ابحث بالاسم أو الرقم..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0" onClick={() => setForm({ id: "", phone: "", name: "", funnel_stage: "lead", notes: "" })}>
              <Plus className="h-4 w-4 ml-1" /> جديدة
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>{form.id ? "تعديل جهة اتصال" : "جهة اتصال جديدة"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>رقم الهاتف (مع الرمز الدولي)</Label>
                <Input required aria-label="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" placeholder="9665xxxxxxxx" />
              </div>
              <div>
                <Label>الاسم</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>مرحلة القمع</Label>
                <Select value={form.funnel_stage} onValueChange={(v) => setForm({ ...form, funnel_stage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {funnelStages.map((s) => (
                      <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button validate onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </header>

      {visible.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{search ? "لا نتائج مطابقة للبحث." : "لا توجد جهات اتصال بعد."}</p>
        </CardContent></Card>
      ) : (
        // minmax(0,1fr): a long name is cut with "…" instead of widening every row past the screen.
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {visible.map((c) => (
            <Card key={c.id} className="min-w-0">
              <CardContent className="py-4 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                    {(c.name ?? c.phone).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name ?? "بدون اسم"}</div>
                    <div className="text-xs text-muted-foreground font-mono" dir="ltr">{c.phone}</div>
                    {/* On a phone the stage sits under the name instead of squeezing it. */}
                    <Badge variant="secondary" className="mt-1 sm:hidden">{STAGE_LABEL[c.funnel_stage] ?? c.funnel_stage}</Badge>
                  </div>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">{STAGE_LABEL[c.funnel_stage] ?? c.funnel_stage}</Badge>
                <div className="flex gap-0.5 sm:gap-1 shrink-0">
                  <Button validate size="icon" variant="ghost" onClick={() => chatMut.mutate(c.id)} title="محادثة">
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => {
                    setForm({
                      id: c.id, phone: c.phone, name: c.name ?? "",
                      funnel_stage: c.funnel_stage, notes: c.notes ?? "",
                    });
                    setOpen(true);
                  }} title="تعديل">
                    <User className="h-4 w-4" />
                  </Button>
                  <Button validate size="icon" variant="ghost" className="text-destructive" onClick={() => { if (confirm("حذف؟")) delMut.mutate(c.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
