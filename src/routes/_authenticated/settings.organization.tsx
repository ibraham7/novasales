import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getMyOrganization, updateOrganization } from "@/modules/organization";

export const Route = createFileRoute("/_authenticated/settings/organization")({
  component: OrgSettingsPage,
});

function OrgSettingsPage() {
  const qc = useQueryClient();
  const getOrg = useServerFn(getMyOrganization);
  const updOrg = useServerFn(updateOrganization);
  const orgQ = useQuery({ queryKey: ["my-org"], queryFn: () => getOrg() });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    if (orgQ.data) {
      setName(orgQ.data.name ?? "");
      setSlug(orgQ.data.slug ?? "");
    }
  }, [orgQ.data]);

  const saveMut = useMutation({
    mutationFn: () => updOrg({ data: { name: name.trim(), slug: slug.trim() } }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["my-org"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-6" dir="rtl">
      <h2 className="text-lg font-semibold mb-4">معلومات المؤسسة</h2>
      <div className="space-y-4 max-w-md">
        <div>
          <Label>اسم المؤسسة</Label>
          <Input required aria-label="اسم المؤسسة" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>المعرّف (Slug)</Label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          <p className="text-xs text-muted-foreground mt-1">أحرف صغيرة، أرقام، وشرطات فقط.</p>
        </div>
        <Button validate onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          حفظ التغييرات
        </Button>
      </div>
    </Card>
  );
}
