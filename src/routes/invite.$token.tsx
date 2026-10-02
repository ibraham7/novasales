import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getInvitationByToken, acceptInvitation } from "@/modules/invitations";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "قبول الدعوة - NovaSales" },
      { name: "description", content: "قبول دعوة الانضمام إلى مؤسسة." },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const getInv = useServerFn(getInvitationByToken);
  const accept = useServerFn(acceptInvitation);

  const invQ = useQuery({
    queryKey: ["invite", token],
    queryFn: () => getInv({ data: { token } }),
  });

  const acceptMut = useMutation({
    mutationFn: () => accept({ data: { token } }),
    onSuccess: () => {
      toast.success("تم الانضمام إلى المؤسسة");
      navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30" dir="rtl">
      <Card className="p-8 max-w-md w-full space-y-4">
        <h1 className="text-2xl font-bold">دعوة انضمام</h1>
        {invQ.isLoading && <p className="text-muted-foreground">جارٍ التحقق...</p>}
        {invQ.data === null && <p className="text-destructive">الدعوة غير موجودة.</p>}
        {invQ.data && (
          <>
            <div className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground">المؤسسة</div>
                <div className="font-semibold">{invQ.data.organization?.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">الدور</div>
                <div className="font-semibold">{invQ.data.role?.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">البريد</div>
                <div className="font-medium">{invQ.data.email}</div>
              </div>
              <div>
                <Badge variant={invQ.data.status === "valid" ? "default" : "destructive"}>
                  {invQ.data.status === "valid" && "صالحة"}
                  {invQ.data.status === "accepted" && "مقبولة سابقاً"}
                  {invQ.data.status === "revoked" && "ملغاة"}
                  {invQ.data.status === "expired" && "منتهية"}
                </Badge>
              </div>
            </div>
            <Button validate
              className="w-full"
              disabled={invQ.data.status !== "valid" || acceptMut.isPending}
              onClick={() => acceptMut.mutate()}
            >
              قبول الدعوة والانضمام
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
