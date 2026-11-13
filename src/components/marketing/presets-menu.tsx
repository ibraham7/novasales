import { useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { PRESETS, type Filters } from "@/modules/marketing/filters";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Saved = { id: string; name: string; filters: Filters };

/** «فلاتر جاهزة»: pick a ready set (clinics, WhatsApp-ready…) or one of your own, or save the current filters as your own. */
export function PresetsMenu({ current, active, saved, onApply, onSave, onDelete, saving }: { current: Filters; active: boolean; saved: Saved[]; onApply: (f: Filters) => void; onSave: (name: string) => void; onDelete: (id: string) => void; saving: boolean }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const apply = (label: string, filters: Filters, needsData: string[] = []) => {
    onApply(filters);
    setOpen(false);
    toast.success(`طُبّقت فلاتر «${label}»`);
    if (needsData.length) toast.success(`تحتاج مصدر بيانات وستُطبَّق لاحقاً: ${needsData.join(" · ")}`);
  };
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setNaming(false);
    setName("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Sparkles className="ml-1 h-4 w-4" /> فلاتر جاهزة
          </Button>
        </PopoverTrigger>
        <PopoverContent dir="rtl" align="start" className="max-h-[70vh] w-80 overflow-y-auto p-2">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">قوالب جاهزة</p>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="block w-full rounded-md px-2 py-1.5 text-right hover:bg-muted" onClick={() => apply(p.name, p.filters, p.needsData)}>
              <span className="block text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">{p.hint}</span>
            </button>
          ))}
          <p className="mt-2 border-t px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">فلاتري (مخصصة)</p>
          {saved.length === 0 && <p className="px-2 pb-1 text-xs text-muted-foreground">لا توجد فلاتر محفوظة بعد. فعّل فلاتر ثم احفظها من الزر أدناه.</p>}
          {saved.map((s) => (
            <div key={s.id} className="flex items-center gap-1 rounded-md hover:bg-muted">
              <button type="button" className="flex-1 px-2 py-1.5 text-right text-sm" onClick={() => apply(s.name, s.filters)}>
                {s.name}
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground"
                aria-label={`حذف ${s.name}`}
                onClick={async () => {
                  if (await askConfirm({ title: "حذف الفلاتر المحفوظة؟", description: `«${s.name}» تُحذف من قائمة فلاتر مؤسستك.`, confirmLabel: "حذف", destructive: true })) onDelete(s.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2 w-full"
            disabled={!active || saving}
            onClick={() => {
              setOpen(false);
              setNaming(true);
            }}
          >
            {saving ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Plus className="ml-1 h-4 w-4" />}
            حفظ الفلاتر الحالية كفلتر جاهز
          </Button>
          {!active && <p className="px-1 pt-1 text-[11px] text-muted-foreground">فعّل فلتراً واحداً على الأقل لتتمكن من حفظه.</p>}
        </PopoverContent>
      </Popover>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حفظ كفلتر جاهز</DialogTitle>
            <DialogDescription>اكتب اسماً (مثل «صيدليات إسطنبول»). يظهر في قائمة «فلاتر جاهزة» لكل فريق مؤسستك. الحفظ بنفس الاسم يستبدل القديم.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} maxLength={100} placeholder="اسم الفلتر" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setNaming(false)}>إلغاء</Button>
            <Button disabled={!name.trim()} onClick={submit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
