import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { clearLocalAuthStorage, withAuthTimeout } from "@/lib/auth-session";

const searchSchema = z.object({ redirect: z.string().optional() });

function safeDestination(redirect: string | undefined) {
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("/auth")) {
    return "/dashboard" as const;
  }
  return redirect;
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول - NovaSales" },
      { name: "description", content: "سجّل دخولك إلى منصة إدارة المبيعات والمحادثات." },
      { property: "og:title", content: "تسجيل الدخول - NovaSales" },
      { property: "og:description", content: "منصة إدارة عمليات المبيعات متعددة الأقسام." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const raw = email.trim();
        const { error } = await withAuthTimeout(supabase.auth.signUp({
          email: raw.includes("@") ? raw : `${raw.replace(/\s+/g, "").toLowerCase()}@demo.app`,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName, role: "user" },
          },
        }));
        if (error) throw error;
        toast.success("تم إنشاء الحساب");
      } else {
        const identifier = email.trim();
        const loginEmail = identifier.includes("@")
          ? identifier
          : `${identifier.replace(/\s+/g, "").toLowerCase()}@demo.app`;
        // Clear a stale persisted refresh token before the lazy auth client is
        // first used on this public page. A successful sign-in persists the new
        // session immediately.
        clearLocalAuthStorage();
        const { data: signed, error } = await withAuthTimeout(
          supabase.auth.signInWithPassword({ email: loginEmail, password }),
        );
        if (error) throw error;
        if (!signed.session) throw new Error("تعذّر إنشاء الجلسة");
        toast.success("مرحباً بك");
        navigate({ to: safeDestination(search.redirect), replace: true });
        return;
      }
      navigate({ to: safeDestination(search.redirect), replace: true });

    } catch (err: any) {
      if (err instanceof Error && err.message.includes("لا تستجيب")) {
        clearLocalAuthStorage();
      }
      toast.error(err.message ?? (mode === "signup" ? "فشل إنشاء الحساب" : "فشل تسجيل الدخول"));
    } finally {
      setLoading(false);
    }
  }


  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-primary">
            <MessageCircle className="h-8 w-8" />
            <h1 className="text-2xl font-bold">NovaSales</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {mode === "signup" ? "إنشاء حساب جديد" : "منصة إدارة عمليات المبيعات"}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="fullname">الاسم الكامل</Label>
              <Input id="fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">اسم المستخدم أو البريد الإلكتروني</Label>
            <Input id="email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "signup" ? "إنشاء الحساب" : "تسجيل الدخول"}
          </Button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
              className="text-sm text-primary hover:underline"
            >
              {mode === "signup" ? "لديك حساب؟ تسجيل الدخول" : "ما عندك حساب؟ إنشاء حساب جديد"}
            </button>
          </div>
        </form>

      </Card>
    </div>
  );
}
