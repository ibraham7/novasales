import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

/** Synchronous session probe: reads the persisted Supabase token straight from
 *  localStorage so we can redirect on the very first tick instead of waiting
 *  for an async getSession() round-trip (which caused a white screen). */
function hasLocalSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token ?? parsed?.currentSession?.access_token;
      if (token) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "NovaSales — منصة إدارة المبيعات والمحادثات" },
      { name: "description", content: "منصة SaaS لإدارة فرق المبيعات والمحادثات متعددة القنوات." },
      { property: "og:title", content: "NovaSales — منصة إدارة المبيعات والمحادثات" },
      { property: "og:description", content: "منصة SaaS لإدارة فرق المبيعات والمحادثات متعددة القنوات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    throw redirect({ to: hasLocalSession() ? "/dashboard" : "/auth", replace: true });
  },
  component: () => (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  ),
});
