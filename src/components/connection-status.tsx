import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Small status strip for weak/unstable networks: tells the user exactly what is
 * happening instead of leaving them with an endless spinner.
 */
export function ConnectionStatus() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      setReconnecting(true);
      qc.refetchQueries({ type: "active" }).finally(() => setReconnecting(false));
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [qc]);

  if (online && !reconnecting) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-3 left-1/2 z-[60] -translate-x-1/2 rounded-full border bg-card px-4 py-2 text-sm font-semibold shadow-lg flex items-center gap-2"
    >
      {online ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          <span>جارٍ إعادة المزامنة…</span>
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4 text-destructive" />
          <span>لا يوجد اتصال — سيتم المتابعة تلقائياً عند رجوع الشبكة</span>
        </>
      )}
    </div>
  );
}
