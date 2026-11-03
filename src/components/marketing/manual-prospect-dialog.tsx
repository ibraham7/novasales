import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { addMarketingProspect } from "@/modules/marketing/outbound.functions";
import { MARKETING_COUNTRIES } from "@/modules/marketing/countries";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass = "w-full rounded-md border bg-background p-2 text-sm";

/** Adds one business by hand: the team's own numbers for a test, or a contact found elsewhere. */
export function ManualProspectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const addFn = useServerFn(addMarketingProspect);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("TR");
  const [category, setCategory] = useState("");
  const [website, setWebsite] = useState("");

  const add = useMutation({
    mutationFn: () => addFn({ data: { name, phone, country: country as any, category: category || undefined, website: website || undefined } }),
    onSuccess: (r) => {
      if (r.created) toast.success("أُضيفت الجهة");
      else toast.info("هذا الرقم موجود مسبقاً في القائمة");
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
      setName("");
      setPhone("");
      setCategory("");
      setWebsite("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !add.isPending && onOpenChange(value)}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة جهة يدوياً</DialogTitle>
          <DialogDescription>للتجربة على أرقام فريقك أو لجهة وجدتها من مصدر آخر. تدخل القائمة بحالة «مكتشف حديثاً».</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="mp-name">اسم الجهة</Label>
            <Input id="mp-name" required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-[1fr_9rem] gap-2">
            <div className="space-y-1">
              <Label htmlFor="mp-phone">رقم الهاتف (واتساب)</Label>
              <Input id="mp-phone" dir="ltr" required placeholder="+905321234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mp-country">دولة الرقم</Label>
              <select id="mp-country" className={selectClass} value={country} onChange={(e) => setCountry(e.target.value)}>
                {MARKETING_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mp-cat">النشاط (اختياري)</Label>
            <Input id="mp-cat" maxLength={120} value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mp-web">الموقع الإلكتروني (اختياري)</Label>
            <Input id="mp-web" dir="ltr" maxLength={300} placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={add.isPending} onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              إضافة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
