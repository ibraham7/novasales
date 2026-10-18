import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Red confirm button for deleting or cancelling. */
  destructive?: boolean;
};
type Request = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((request: Request) => void) | null = null;

/**
 * The site's own confirmation dialog instead of the browser's: `if (await askConfirm({ title: "حذف القالب؟" }))`.
 * Resolves false when closed or cancelled.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(options.title));
    show({ ...options, resolve });
  });
}

/** Mounted once in the root layout. */
export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    show = setRequest;
    return () => {
      show = null;
    };
  }, []);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent dir="rtl" className="sm:max-w-md">
        <AlertDialogHeader className="text-right sm:text-right">
          <AlertDialogTitle className="flex items-center gap-2">
            {request?.destructive && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </span>
            )}
            {request?.title}
          </AlertDialogTitle>
          {request?.description && <AlertDialogDescription>{request.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <Button type="button" variant={request?.destructive ? "destructive" : "default"} onClick={() => close(true)} autoFocus>
            {request?.confirmLabel ?? "تأكيد"}
          </Button>
          <AlertDialogCancel className="mt-0">إلغاء</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
