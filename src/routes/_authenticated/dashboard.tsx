import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clapperboard, FileVideo, Mic2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "مشاريعي — iM STUDIO" }, { name: "description", content: "إدارة مشاريع الإعلانات والفيديو والصوت." }] }),
  component: Dashboard,
});

const KINDS = [
  { id: "ad", label: "إعلان من الصور", icon: Clapperboard },
  { id: "explainer", label: "شرح إلى فيديو", icon: FileVideo },
  { id: "voice", label: "صوت", icon: Mic2 },
] as const;

const STATUS: Record<string, string> = { draft: "مسودة" };

function Dashboard() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [usage, setUsage] = useState<{ service: string; units: number; unit: string }[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"ad" | "explainer" | "voice">("ad");
  const navigate = useNavigate();

  useEffect(() => {
    supabase.from("projects").select("id,name,kind,status,updated_at").order("updated_at", { ascending: false }).then(({ data }) => setProjects(data ?? []));
    supabase.from("usage_events").select("service,units,unit").then(({ data }) => setUsage((data as any) ?? []));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from("projects").insert({ name: name.trim() || "مشروع بدون اسم", kind }).select().single();
    if (error) { toast.error("تعذر إنشاء المشروع"); return; }
    navigate({ to: "/projects/$id", params: { id: data.id } });
  }

  const sum = (s: string) => usage.filter((u) => u.service === s).reduce((a, u) => a + Number(u.units), 0);

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="text-3xl font-bold">مشاريعي</h1>
        <p className="mt-1 text-muted-foreground">ابدأ مشروعًا جديدًا أو أكمل عملك السابق.</p>
      </div>

      <form onSubmit={create} className="glass space-y-4 rounded-2xl p-5">
        <div className="grid grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <button type="button" key={k.id} onClick={() => setKind(k.id)} className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-sm transition ${kind === k.id ? "border-gold/60 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
              <k.icon className="h-5 w-5" /> {k.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="اسم المشروع، مثل: إعلان عود الملكي" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          <Button type="submit" variant="luxe" className="h-11"><Plus /> إنشاء</Button>
        </div>
      </form>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="ثواني فيديو مولدة" value={sum("video")} />
        <Stat label="حروف صوت مولدة" value={sum("voice")} />
        <Stat label="طلبات ذكاء" value={sum("chat") + sum("planning")} />
      </div>

      {projects === null ? (
        <p className="text-muted-foreground">جارٍ التحميل…</p>
      ) : projects.length === 0 ? (
        <p className="glass rounded-2xl p-8 text-center text-muted-foreground">لا توجد مشاريع بعد. أنشئ أول مشروع بالأعلى.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const K = KINDS.find((k) => k.id === p.kind) ?? KINDS[0];
            return (
              <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="glass card-hover group animate-pop rounded-2xl p-5">
                <K.icon className="h-6 w-6 text-gold transition-transform duration-300 group-hover:scale-110" />
                <h3 className="mt-3 font-bold">{p.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{K.label} · {STATUS[p.status] ?? p.status} · {new Date(p.updated_at).toLocaleDateString("ar-SA")}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-brand text-2xl font-bold">{value.toLocaleString("ar-SA")}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
