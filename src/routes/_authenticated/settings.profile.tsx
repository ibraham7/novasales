import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMyProfile, updateMyProfile, listMyOrganizations, switchActiveOrganization } from "@/modules/identity";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const qc = useQueryClient();
  const getP = useServerFn(getMyProfile);
  const updP = useServerFn(updateMyProfile);
  const listOrgs = useServerFn(listMyOrganizations);
  const switchOrg = useServerFn(switchActiveOrganization);

  const profileQ = useQuery({ queryKey: ["my-profile"], queryFn: () => getP() });
  const orgsQ = useQuery({ queryKey: ["my-orgs"], queryFn: () => listOrgs() });

  const [name, setName] = useState("");
  useEffect(() => {
    if (profileQ.data?.full_name) setName(profileQ.data.full_name);
  }, [profileQ.data]);

  const saveMut = useMutation({
    mutationFn: () => updP({ data: { fullName: name.trim() } }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const switchMut = useMutation({
    mutationFn: (id: string) => switchOrg({ data: { organizationId: id } }),
    onSuccess: () => {
      toast.success("تم تبديل المؤسسة");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">الملف الشخصي</h2>
        <div className="space-y-4 max-w-md">
          <div>
            <Label>الاسم الكامل</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name.trim()}>
            حفظ
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">مؤسساتي</h2>
        <div className="space-y-2">
          {(orgsQ.data ?? []).map((o: any) => {
            const isActive = profileQ.data?.active_organization_id === o.id;
            return (
              <div key={o.id} className="flex items-center justify-between p-3 rounded border">
                <div>
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.slug}</div>
                </div>
                {isActive ? (
                  <Badge>نشطة</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => switchMut.mutate(o.id)}>
                    تبديل
                  </Button>
                )}
              </div>
            );
          })}
          {(orgsQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">لا توجد مؤسسات.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
