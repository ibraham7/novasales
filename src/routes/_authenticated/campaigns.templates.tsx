import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { ArrowRight, Plus, Trash2, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { listTemplates, saveTemplate, deleteTemplate, listTemplateVersions } from "@/modules/campaigns";

export const Route = createFileRoute("/_authenticated/campaigns/templates")({
  head: () => ({ meta: [{ title: "قوالب الحملات - NovaSales" }] }),
  component: TemplatesPage,
});

function extractVars(body: string): string[] {
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[1]);
  return Array.from(out);
}

function TemplatesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTemplates);
  const saveFn = useServerFn(saveTemplate);
  const delFn = useServerFn(deleteTemplate);
  const versFn = useServerFn(listTemplateVersions);
  const q = useQuery({ queryKey: ["templates"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const versQ = useQuery({ queryKey: ["template-versions", historyId], queryFn: () => versFn({ data: { templateId: historyId! } }), enabled: !!historyId });

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: { id: editId ?? undefined, name, body, variables: extractVars(body) } }),
    onSuccess: () => { toast.success("تم الحفظ"); setOpen(false); setEditId(null); setName(""); setBody(""); qc.invalidateQueries({ queryKey: ["templates"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["templates"] }); },
  });

  const startEdit = (t: any) => { setEditId(t.id); setName(t.name); setBody(t.body); setOpen(true); };

  return (
    <div className="p-8 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/campaigns"><Button size="sm" variant="ghost"><ArrowRight className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-bold">قوالب الحملات</h1>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setName(""); setBody(""); } }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 ml-1" /> قالب جديد</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "تعديل قالب" : "قالب جديد"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>الاسم</Label><Input required aria-label="اسم القالب" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div>
                <Label>النص (استخدم {`{{name}}`} للمتغيرات)</Label>
                <Textarea required aria-label="نص القالب" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
                {body && (
                  <div className="text-xs text-muted-foreground mt-1">المتغيرات: {extractVars(body).map((v) => <Badge key={v} variant="outline" className="ml-1">{v}</Badge>)}</div>
                )}
              </div>
            </div>
            <DialogFooter><Button validate onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {(q.data?.templates ?? []).map((t: any) => (
          <Card key={t.id} className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2"><span className="font-semibold">{t.name}</span><Badge variant="outline">v{t.version}</Badge></div>
                <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{t.body}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => startEdit(t)}>تعديل</Button>
              <Button size="sm" variant="ghost" onClick={() => setHistoryId(t.id)}><History className="h-3 w-3" /></Button>
              <Button validate size="sm" variant="ghost" onClick={() => { if (confirm("حذف؟")) delMut.mutate(t.id); }}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </Card>
        ))}
        {q.data?.templates.length === 0 && <Card className="p-8 text-center text-muted-foreground">لا توجد قوالب.</Card>}
      </div>

      <Dialog open={!!historyId} onOpenChange={(v) => !v && setHistoryId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>سجل النسخ</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-96 overflow-auto">
            {(versQ.data?.versions ?? []).map((v: any) => (
              <Card key={v.id} className="p-3">
                <div className="flex items-center gap-2"><Badge>v{v.version}</Badge><span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span></div>
                <pre className="text-xs whitespace-pre-wrap mt-2">{v.body}</pre>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
