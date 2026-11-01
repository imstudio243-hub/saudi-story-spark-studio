import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Loader2, Shield, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { testServices } from "@/lib/studio.functions";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "الإدارة — iM STUDIO" }, { name: "description", content: "حالة الخدمات وإحصاءات الاستخدام." }] }),
  component: AdminPage,
});

type ServiceStatus = { name: string; task: string; model: string; ok: boolean; error: string | null };

function AdminPage() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [users, setUsers] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("usage_events").select("service,units,unit,created_at").order("created_at", { ascending: false }).limit(100).then(({ data }) => setUsage(data ?? []));
    supabase.from("generation_jobs").select("id,kind,status,model,error,created_at").order("created_at", { ascending: false }).limit(20).then(({ data }) => setJobs(data ?? []));
    supabase.from("profiles").select("id", { count: "exact", head: true }).then(({ count }) => setUsers(count));
  }, [isAdmin]);

  async function runTest() {
    setTesting(true);
    try {
      const r = await testServices();
      setServices(r as ServiceStatus[]);
      if ((r as ServiceStatus[]).every((s) => s.ok)) toast.success("جميع الخدمات تعمل");
      else toast.error("بعض الخدمات غير متاحة");
    } catch (e: any) {
      toast.error(e.message || "فشل اختبار الخدمات");
    } finally {
      setTesting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-muted-foreground">
        <Shield className="mx-auto mb-3 h-8 w-8" />
        هذه الصفحة متاحة للمدير فقط.
      </div>
    );
  }

  const sum = (s: string) => usage.filter((u) => u.service === s).reduce((a, u) => a + Number(u.units), 0);

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="text-3xl font-bold">لوحة الإدارة</h1>
        <p className="mt-1 text-muted-foreground">حالة خدمات الذكاء وإحصاءات المنصة.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="المستخدمون" value={users ?? 0} />
        <Stat label="ثواني فيديو" value={sum("video")} />
        <Stat label="حروف صوت" value={sum("voice")} />
        <Stat label="طلبات ذكاء" value={sum("chat") + sum("planning")} />
      </div>

      <section className="glass space-y-4 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold"><Activity className="h-5 w-5 text-gold" /> حالة الخدمات</h2>
          <Button variant="luxe" onClick={runTest} disabled={testing} className="h-10">
            {testing ? <Loader2 className="animate-spin" /> : null} اختبر الخدمات
          </Button>
        </div>
        {services === null ? (
          <p className="text-sm text-muted-foreground">اضغط «اختبر الخدمات» للتحقق من اتصال نماذج الذكاء.</p>
        ) : (
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.task} className="glass flex items-center justify-between rounded-xl p-3 text-sm">
                <div>
                  <p className="font-bold">{s.name}</p>
                  <p dir="ltr" className="text-left text-xs text-muted-foreground">{s.model}</p>
                </div>
                {s.ok ? (
                  <span className="flex items-center gap-1 text-gold"><CheckCircle2 className="h-4 w-4" /> تعمل</span>
                ) : (
                  <span className="flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" /> {s.error || "متوقفة"}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass space-y-3 rounded-2xl p-5">
        <h2 className="font-bold">آخر مهام التوليد</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد مهام بعد.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {jobs.map((j) => (
              <div key={j.id} className="glass flex items-center justify-between rounded-xl p-3">
                <span>{j.kind === "video" ? "فيديو" : "صوت"} · {new Date(j.created_at).toLocaleString("ar-SA")}</span>
                <span className={j.status === "completed" ? "text-gold" : j.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                  {j.status === "completed" ? "مكتمل" : j.status === "failed" ? "فشل" : j.status === "running" ? "قيد التنفيذ" : j.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-4 text-center">
      <div className="text-brand text-2xl font-bold">{value.toLocaleString("ar-SA")}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
