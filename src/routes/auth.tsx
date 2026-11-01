import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — iM STUDIO" },
      { name: "description", content: "سجّل دخولك أو أنشئ حسابًا في iM STUDIO." },
      { property: "og:title", content: "تسجيل الدخول — iM STUDIO" },
      { property: "og:description", content: "ادخل إلى استوديو الإعلانات والفيديو والصوت." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav({ to: "/dashboard" });
  }, [user, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/dashboard` } });
        if (error) throw error;
        if (!data.session) toast.success("تم إنشاء الحساب. افتح بريدك لتأكيد الحساب ثم سجّل الدخول.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message === "Invalid login credentials" ? "البريد أو كلمة المرور غير صحيحة" : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("تعذر تسجيل الدخول عبر Google");
  }

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="glass w-full max-w-sm animate-rise rounded-3xl p-7 shadow-luxe">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">{mode === "in" ? "أهلًا بعودتك" : "أنشئ حسابك"}</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input id="email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw">كلمة المرور</Label>
            <Input id="pw" type="password" dir="ltr" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" variant="luxe" className="h-11 w-full" disabled={busy}>
            {mode === "in" ? "تسجيل الدخول" : "إنشاء الحساب"}
          </Button>
        </form>
        <Button variant="glass" className="mt-3 h-11 w-full" onClick={google}>
          المتابعة عبر Google
        </Button>
        <button className="mt-5 w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "ليس لديك حساب؟ أنشئ حسابًا" : "لديك حساب؟ سجّل الدخول"}
        </button>
      </div>
    </div>
  );
}
