import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { confirmStopLink, getStopLink } from "@/modules/marketing/stop.functions";

export const Route = createFileRoute("/stop/$token")({
  head: () => ({
    meta: [{ title: "إيقاف الرسائل" }, { name: "robots", content: "noindex" }],
  }),
  component: StopPage,
});

function StopPage() {
  const { token } = Route.useParams();
  const info = useServerFn(getStopLink);
  const confirm = useServerFn(confirmStopLink);
  const q = useQuery({ queryKey: ["stop-link", token], queryFn: () => info({ data: { token } }), retry: false });
  const stop = useMutation({ mutationFn: () => confirm({ data: { token } }) });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6" dir="rtl">
      <Card className="w-full max-w-md space-y-4 p-8 text-center">
        <h1 className="text-xl font-bold">إيقاف الرسائل</h1>
        {q.isPending && <p className="text-muted-foreground">جارٍ التحقق…</p>}
        {q.data && !q.data.valid && <p className="text-destructive">هذا الرابط غير صالح.</p>}
        {q.isError && <p className="text-destructive">تعذر فتح الصفحة؛ أعد المحاولة لاحقاً.</p>}
        {q.data?.valid && !stop.data?.ok && (
          <>
            <p className="text-muted-foreground">
              {q.data.sender ? `لن تصلك أي رسائل أخرى من ${q.data.sender} على هذا الرقم.` : "لن تصلك أي رسائل أخرى على هذا الرقم."}
            </p>
            <Button className="w-full" disabled={stop.isPending} onClick={() => stop.mutate()}>
              {stop.isPending ? "جارٍ الإيقاف…" : "تأكيد إيقاف الرسائل"}
            </Button>
            {stop.isError && <p className="text-sm text-destructive">{(stop.error as Error).message}</p>}
          </>
        )}
        {stop.data?.ok && <p className="font-medium text-primary">تم. لن تصلك رسائل أخرى. شكراً لك.</p>}
        {stop.data && !stop.data.ok && <p className="text-destructive">هذا الرابط غير صالح.</p>}
      </Card>
    </div>
  );
}
