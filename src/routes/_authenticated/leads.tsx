import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Users2, Plus, Trash2, ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listLeads, createLead, deleteLead, convertLeadToOpportunity } from "@/modules/crm";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "العملاء المحتملون - NovaSales" },
      { name: "description", content: "إدارة العملاء المحتملين وتحويلهم إلى فرص." },
    ],
  }),
  component: LeadsPage,
});

const STATUS_LABEL: Record<string, string> = {
  new: "جديد",
  working: "قيد المتابعة",
  qualified: "مؤهل",
  unqualified: "غير مؤهل",
  converted: "تم التحويل",
  lost: "خاسر",
};
const STATUS_COLOR: Record<string, string> = {
  new: "bg-slate-500",
  working: "bg-blue-500",
  qualified: "bg-purple-500",
  unqualified: "bg-orange-500",
  converted: "bg-emerald-500",
  lost: "bg-red-500",
};

function LeadsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listLeads);
  const create = useServerFn(createLead);
  const remove = useServerFn(deleteLead);
  const convert = useServerFn(convertLeadToOpportunity);

  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contactName: "", phone: "", email: "", source: "", notes: "" });

  const leadsQ = useQuery({
    queryKey: ["leads", status, search],
    queryFn: () =>
      list({
        data: {
          status: status === "all" ? undefined : (status as any),
          search: search || undefined,
        },
      }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          contactName: form.contactName,
          phone: form.phone || undefined,
          email: form.email || undefined,
          source: form.source || undefined,
          notes: form.notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("تم إنشاء العميل المحتمل");
      setOpen(false);
      setForm({ contactName: "", phone: "", email: "", source: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => remove({ data: { leadId: id } }),
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => convert({ data: { leadId: id } }),
    onSuccess: () => {
      toast.success("تم تحويل العميل إلى فرصة");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users2 className="h-6 w-6" /> العملاء المحتملون
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            هنا تدير كل العملاء المحتملين قبل تحويلهم إلى فرص مبيعات فعلية.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="ابحث بالاسم أو الرقم..."
            className="w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 ml-1" /> عميل محتمل</Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>عميل محتمل جديد</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>الاسم *</Label>
                  <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الهاتف</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div>
                    <Label>البريد</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>المصدر</Label>
                  <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="مثلاً: واتساب / إعلان..." />
                </div>
                <div>
                  <Label>ملاحظات</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={!form.contactName || createMut.isPending}
                  onClick={() => createMut.mutate()}
                >
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-right p-3">الاسم</th>
              <th className="text-right p-3">الحالة</th>
              <th className="text-right p-3">المصدر</th>
              <th className="text-right p-3">تاريخ الإنشاء</th>
              <th className="p-3 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {(leadsQ.data ?? []).map((l: any) => (
              <tr key={l.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-medium">{l.contact_name ?? "—"}</td>
                <td className="p-3">
                  <Badge className={STATUS_COLOR[l.status] ?? "bg-slate-500"}>
                    {STATUS_LABEL[l.status] ?? l.status}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground">{l.source ?? "—"}</td>
                <td className="p-3 text-muted-foreground text-xs">
                  {new Date(l.opened_at).toLocaleDateString("ar-EG")}
                </td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={l.status === "converted" || convertMut.isPending}
                      onClick={() => convertMut.mutate(l.id)}
                    >
                      <ArrowRightLeft className="h-3 w-3 ml-1" /> فرصة
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف هذا العميل المحتمل؟")) removeMut.mutate(l.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {(leadsQ.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted-foreground py-10">
                  لا يوجد عملاء محتملون
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
