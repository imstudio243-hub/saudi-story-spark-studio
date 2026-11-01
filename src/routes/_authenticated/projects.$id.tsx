import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, ImagePlus, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { planAd, startVideo, pollJob, generateVoice } from "@/lib/studio.functions";
import { AD_STYLES, ASPECTS, DURATIONS, RESOLUTIONS, VOICES, DIALECTS, DELIVERY, type AdPlan } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "المشروع — iM STUDIO" }, { name: "description", content: "تفاصيل المشروع وتوليد الفيديو والصوت." }] }),
  component: ProjectPage,
});

type Asset = { id: string; kind: string; mime: string; storage_path: string; meta: any; url?: string };

async function sign(path: string) {
  const { data } = await supabase.storage.from("studio").createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

function ProjectPage() {
  const { id } = useParams({ from: "/_authenticated/projects/$id" });
  const [project, setProject] = useState<any>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [style, setStyle] = useState("auto");
  const [duration, setDuration] = useState(6);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("9:16");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState<AdPlan | null>(null);
  const [busy, setBusy] = useState<"plan" | "video" | "voice" | "upload" | null>(null);
  const [videoStatus, setVideoStatus] = useState<string>("");
  // voice
  const [vText, setVText] = useState("");
  const [vVoice, setVVoice] = useState("Orus");
  const [vDialect, setVDialect] = useState("saudi");
  const [vDelivery, setVDelivery] = useState("ad");
  const [vPace, setVPace] = useState<"slow" | "normal" | "fast">("normal");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(p);
    if ((p?.data as any)?.plan) setPlan((p!.data as any).plan);
    const { data: a } = await supabase.from("assets").select("id,kind,mime,storage_path,meta").eq("project_id", id).order("created_at", { ascending: false });
    const withUrls = await Promise.all((a ?? []).map(async (x) => ({ ...x, url: await sign(x.storage_path) })));
    setAssets(withUrls);
  }, [id]);

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    try {
      const { data: u } = await supabase.auth.getUser();
      for (const f of Array.from(files).slice(0, 4)) {
        const ext = f.name.split(".").pop() || "png";
        const path = `${u!.user.id}/${id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("studio").upload(path, f, { contentType: f.type });
        if (error) throw error;
        await supabase.from("assets").insert({ project_id: id, kind: "image", source: "uploaded", storage_path: path, mime: f.type, size: f.size });
      }
      toast.success("تم رفع الصور");
      await load();
    } catch (e: any) {
      toast.error(e.message || "تعذر رفع الصور");
    } finally {
      setBusy(null);
    }
  }

  async function makePlan() {
    setBusy("plan");
    try {
      const p = await planAd({ data: { projectId: id, mode: project.kind === "explainer" ? "explainer" : "images", style, duration, brief, assetIds: selected } });
      setPlan(p);
      toast.success("تم إنشاء السيناريو");
    } catch (e: any) {
      toast.error(e.message || "فشل إنشاء السيناريو");
    } finally {
      setBusy(null);
    }
  }

  async function makeVideo() {
    if (!plan) return;
    setBusy("video");
    setVideoStatus("جارٍ إرسال الطلب…");
    try {
      const { jobId } = await startVideo({ data: { projectId: id, prompt: plan.video_prompt, assetIds: selected, duration, aspect, resolution } });
      const tick = async () => {
        const r = await pollJob({ data: { jobId } });
        if (r.status === "completed") {
          setVideoStatus("");
          setBusy(null);
          toast.success("تم توليد الفيديو وحفظه");
          await load();
          return;
        }
        if (r.status === "failed") {
          setVideoStatus("");
          setBusy(null);
          toast.error((r as any).error || "فشل توليد الفيديو");
          return;
        }
        setVideoStatus(r.status === "saving" ? "جارٍ حفظ الفيديو…" : `جارٍ التوليد… ${(r as any).progress ? Math.round((r as any).progress * 100) + "%" : ""}`);
        pollRef.current = setTimeout(tick, 5000);
      };
      pollRef.current = setTimeout(tick, 5000);
    } catch (e: any) {
      setVideoStatus("");
      setBusy(null);
      toast.error(e.message || "فشل بدء توليد الفيديو");
    }
  }

  async function makeVoice() {
    setBusy("voice");
    try {
      await generateVoice({ data: { projectId: id, text: vText, voice: vVoice, dialect: vDialect, delivery: vDelivery, pace: vPace } });
      toast.success("تم توليد الصوت");
      setVText("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل توليد الصوت");
    } finally {
      setBusy(null);
    }
  }

  if (!project) return <p className="text-muted-foreground">جارٍ التحميل…</p>;

  const images = assets.filter((a) => a.kind === "image");
  const videos = assets.filter((a) => a.kind === "video");
  const audios = assets.filter((a) => a.kind === "audio");
  const isVoice = project.kind === "voice";

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <p className="mt-1 text-muted-foreground">{isVoice ? "مشروع صوتي" : project.kind === "explainer" ? "تحويل شرح إلى فيديو" : "إعلان من الصور"}</p>
      </div>

      {!isVoice && (
        <>
          {/* Images */}
          <section className="glass space-y-4 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">صور المنتج</h2>
              <label className="cursor-pointer">
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
                <span className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                  {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} رفع صور
                </span>
              </label>
            </div>
            {images.length === 0 ? (
              <p className="text-sm text-muted-foreground">ارفع حتى 4 صور للمنتج ليحللها الذكاء ويستخدمها كإطار أول للفيديو.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {images.map((a) => (
                  <button key={a.id} type="button" onClick={() => setSelected((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id].slice(-3)))}
                    className={`overflow-hidden rounded-xl border-2 transition ${selected.includes(a.id) ? "border-gold" : "border-transparent"}`}>
                    <img src={a.url} alt="" className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Plan */}
          <section className="glass space-y-4 rounded-2xl p-5">
            <h2 className="flex items-center gap-2 font-bold"><Wand2 className="h-5 w-5 text-gold" /> السيناريو</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>الأسلوب</Label>
                <select value={style} onChange={(e) => setStyle(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
                  {AD_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>المدة</Label>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
                  {DURATIONS.map((d) => <option key={d} value={d}>{d} ثوانٍ</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>الأبعاد / الجودة</Label>
                <div className="flex gap-2">
                  <select value={aspect} onChange={(e) => setAspect(e.target.value as any)} className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm">
                    {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
                  </select>
                  <select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm">
                    {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <Textarea placeholder={project.kind === "explainer" ? "الصق الشرح أو الخطوات هنا…" : "ملاحظات إضافية (اختياري): الجمهور، العرض، ألوان الهوية…"} value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} />
            <Button variant="luxe" onClick={makePlan} disabled={busy !== null} className="h-11">
              {busy === "plan" ? <Loader2 className="animate-spin" /> : <Sparkles />} {plan ? "أعد إنشاء السيناريو" : "أنشئ السيناريو بالذكاء"}
            </Button>

            {plan && (
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div>
                  <p className="text-xs text-muted-foreground">العنوان الإعلاني</p>
                  <p className="text-lg font-bold text-gold">{plan.headline}</p>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <p><span className="text-muted-foreground">المنتج: </span>{plan.product}</p>
                  <p><span className="text-muted-foreground">الأسلوب: </span>{plan.style}</p>
                  <p><span className="text-muted-foreground">الجمهور: </span>{plan.audience}</p>
                </div>
                <div className="space-y-2">
                  {plan.scenes.map((s, i) => (
                    <div key={i} className="glass rounded-xl p-3 text-sm">
                      <p className="font-bold">مشهد {i + 1}: {s.title}</p>
                      <p className="mt-1 text-muted-foreground">{s.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">كاميرا: {s.camera} · إضاءة: {s.lighting}</p>
                    </div>
                  ))}
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground">التعليق الصوتي المقترح</p>
                  <p className="mt-1">{plan.voiceover}</p>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">موجه الفيديو (إنجليزي)</summary>
                  <p dir="ltr" className="mt-2 rounded-xl bg-background p-3 text-left text-xs leading-relaxed">{plan.video_prompt}</p>
                </details>
                <Button variant="luxe" onClick={makeVideo} disabled={busy !== null} className="h-11 w-full">
                  {busy === "video" ? <Loader2 className="animate-spin" /> : <Clapperboard />} ولّد الفيديو الآن
                </Button>
                {videoStatus && <p className="text-center text-sm text-muted-foreground">{videoStatus}</p>}
              </div>
            )}
          </section>

          {/* Videos */}
          {videos.length > 0 && (
            <section className="glass space-y-4 rounded-2xl p-5">
              <h2 className="font-bold">الفيديوهات المولدة</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {videos.map((v) => (
                  <div key={v.id} className="space-y-2">
                    <video src={v.url} controls playsInline className="w-full rounded-xl" />
                    <a href={v.url} download className="block text-center text-sm text-gold hover:underline">تنزيل الفيديو</a>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Voice */}
      {(isVoice || plan) && (
        <section className="glass space-y-4 rounded-2xl p-5">
          <h2 className="font-bold">التعليق الصوتي</h2>
          <Textarea placeholder="نص التعليق الصوتي…" value={vText || plan?.voiceover || ""} onChange={(e) => setVText(e.target.value)} rows={3} />
          <div className="grid gap-3 sm:grid-cols-4">
            <select value={vVoice} onChange={(e) => setVVoice(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm">
              {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <select value={vDialect} onChange={(e) => setVDialect(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm">
              {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <select value={vDelivery} onChange={(e) => setVDelivery(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm">
              {DELIVERY.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <select value={vPace} onChange={(e) => setVPace(e.target.value as any)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm">
              <option value="slow">بطيء</option>
              <option value="normal">طبيعي</option>
              <option value="fast">سريع</option>
            </select>
          </div>
          <Button variant="luxe" onClick={makeVoice} disabled={busy !== null || !(vText || plan?.voiceover)} className="h-11">
            {busy === "voice" ? <Loader2 className="animate-spin" /> : <Sparkles />} ولّد الصوت
          </Button>
          {audios.length > 0 && (
            <div className="space-y-2">
              {audios.map((a) => (
                <div key={a.id} className="glass flex items-center gap-3 rounded-xl p-3">
                  <audio src={a.url} controls className="h-10 flex-1" />
                  <a href={a.url} download className="text-sm text-gold hover:underline">تنزيل</a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
