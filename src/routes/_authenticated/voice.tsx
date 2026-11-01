import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateVoice } from "@/lib/studio.functions";
import { VOICES, DIALECTS, DELIVERY } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({ meta: [{ title: "الأصوات — iM STUDIO" }, { name: "description", content: "توليد التعليق الصوتي العربي والسعودي." }] }),
  component: VoicePage,
});

type AudioAsset = { id: string; storage_path: string; meta: any; created_at?: string; url?: string; project_id: string };

async function sign(path: string) {
  const { data } = await supabase.storage.from("studio").createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

function VoicePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Orus");
  const [dialect, setDialect] = useState("saudi");
  const [delivery, setDelivery] = useState("ad");
  const [pace, setPace] = useState<"slow" | "normal" | "fast">("normal");
  const [busy, setBusy] = useState(false);
  const [audios, setAudios] = useState<AudioAsset[]>([]);

  const load = useCallback(async () => {
    // Find or create the shared voice project.
    const { data: projs } = await supabase.from("projects").select("id").eq("kind", "voice").order("created_at").limit(1);
    let pid = projs?.[0]?.id as string | undefined;
    if (!pid) {
      const { data: p } = await supabase.from("projects").insert({ name: "استوديو الأصوات", kind: "voice" }).select().single();
      pid = p?.id;
    }
    setProjectId(pid ?? null);
    if (pid) {
      const { data: a } = await supabase.from("assets").select("id,storage_path,meta,created_at,project_id").eq("kind", "audio").order("created_at", { ascending: false }).limit(20);
      setAudios(await Promise.all((a ?? []).map(async (x) => ({ ...x, url: await sign(x.storage_path) }))));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    if (!projectId || !text.trim()) return;
    setBusy(true);
    try {
      await generateVoice({ data: { projectId, text: text.trim(), voice, dialect, delivery, pace } });
      toast.success("تم توليد الصوت");
      setText("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل توليد الصوت");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="animate-rise">
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Mic2 className="h-7 w-7 text-gold" /> استوديو الأصوات</h1>
        <p className="mt-1 text-muted-foreground">تعليق صوتي عربي وسعودي بأصوات احترافية.</p>
      </div>

      <section className="glass space-y-4 rounded-2xl p-5">
        <Textarea placeholder="اكتب نص التعليق الصوتي هنا…" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>الصوت</Label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
              {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>اللهجة</Label>
            <select value={dialect} onChange={(e) => setDialect(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
              {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>النبرة</Label>
            <select value={delivery} onChange={(e) => setDelivery(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
              {DELIVERY.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>السرعة</Label>
            <select value={pace} onChange={(e) => setPace(e.target.value as any)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
              <option value="slow">بطيئة</option>
              <option value="normal">طبيعية</option>
              <option value="fast">سريعة</option>
            </select>
          </div>
        </div>
        <Button variant="luxe" onClick={generate} disabled={busy || !text.trim() || !projectId} className="h-11 w-full">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} ولّد الصوت
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">الأصوات المولدة</h2>
        {audios.length === 0 ? (
          <p className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">لا توجد أصوات بعد.</p>
        ) : (
          audios.map((a) => (
            <div key={a.id} className="glass space-y-2 rounded-2xl p-4">
              <p className="text-sm text-muted-foreground">{(a.meta as any)?.text?.slice(0, 120) || "تعليق صوتي"}</p>
              <div className="flex items-center gap-3">
                <audio src={a.url} controls className="h-10 flex-1" />
                <a href={a.url} download className="text-sm text-gold hover:underline">تنزيل</a>
                <Link to="/projects/$id" params={{ id: a.project_id }} className="text-sm text-muted-foreground hover:text-foreground">المشروع</Link>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
