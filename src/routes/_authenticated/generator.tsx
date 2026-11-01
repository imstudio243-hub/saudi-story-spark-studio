import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Download, ImagePlus, Loader2, Pause, Play, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { planGenerator, startSceneVideo, generateSceneVoice, pollJob, findRunningSceneJob } from "@/lib/studio.functions";
import { ASPECTS, DELIVERY, DIALECTS, GEN_DURATIONS, RESOLUTIONS, VOICES, type GenPlan } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/generator")({
  validateSearch: (s: Record<string, unknown>) => ({ project: typeof s["project"] === "string" ? (s["project"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "مولّد الفيديو والصوت — iM STUDIO" },
      { name: "description", content: "حوّل وصفًا مكتوبًا إلى فيديو متكامل بالتعليق الصوتي العربي." },
      { property: "og:title", content: "مولّد الفيديو والصوت — iM STUDIO" },
      { property: "og:description", content: "حوّل وصفًا مكتوبًا إلى فيديو متكامل بالتعليق الصوتي العربي." },
    ],
  }),
  component: GeneratorPage,
});

type SceneState = {
  status: "pending" | "rendering" | "voicing" | "ready" | "failed";
  videoUrl?: string | undefined;
  audioUrl?: string | undefined;
  videoAssetId?: string | undefined;
  audioAssetId?: string | undefined;
  error?: string | undefined;
};

type RefImage = { id: string; url: string; path: string; mime: string };

async function sign(path: string) {
  const { data } = await supabase.storage.from("studio").createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

const STATUS_LABEL: Record<SceneState["status"], string> = {
  pending: "بانتظار الدور",
  rendering: "جارٍ توليد اللقطة…",
  voicing: "جارٍ توليد الصوت…",
  ready: "جاهز",
  failed: "فشل — أعد المحاولة",
};

function GeneratorPage() {
  const { project: resumeId } = Route.useSearch();
  const navigate = useNavigate();
  const [step, setStep] = useState<"describe" | "plan" | "generating" | "done">("describe");
  const [projectId, setProjectId] = useState<string | null>(resumeId ?? null);
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<10 | 20 | 30>(30);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("9:16");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [voice, setVoice] = useState("Orus");
  const [dialect, setDialect] = useState("saudi");
  const [delivery, setDelivery] = useState("ad");
  const [pace, setPace] = useState<"slow" | "normal" | "fast">("normal");
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [plan, setPlan] = useState<GenPlan | null>(null);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Resume an existing generator project.
  const resume = useCallback(
    async (id: string) => {
      const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
      if (!p) return;
      const gp = (p.data as any)?.genPlan as GenPlan | undefined;
      const gs = (p.data as any)?.genSettings as { duration?: number } | undefined;
      if (gs?.duration) setDuration(gs.duration as 10 | 20 | 30);
      const { data: assets } = await supabase
        .from("assets")
        .select("id,kind,mime,storage_path,meta")
        .eq("project_id", id)
        .order("created_at", { ascending: false });
      const refs: RefImage[] = [];
      const byScene = new Map<number, SceneState>();
      for (const a of assets ?? []) {
        const url = await sign(a.storage_path);
        if (a.kind === "image") refs.push({ id: a.id, url, path: a.storage_path, mime: a.mime });
        const idx = (a.meta as any)?.sceneIndex;
        if (idx === undefined || idx === null) continue;
        const cur = byScene.get(idx) ?? { status: "pending" as const };
        if (a.kind === "video" && !cur.videoUrl) Object.assign(cur, { videoUrl: url, videoAssetId: a.id });
        if (a.kind === "audio" && !cur.audioUrl) Object.assign(cur, { audioUrl: url, audioAssetId: a.id });
        byScene.set(idx, cur);
      }
      setRefImages(refs);
      if (gp) {
        setPlan(gp);
        const states = gp.scenes.map((_, i) => {
          const s = byScene.get(i);
          if (s?.videoUrl) return { ...s, status: "ready" as const };
          return { status: "pending" as const };
        });
        setScenes(states);
        setStep(states.every((s) => s.status === "ready") && states.length > 0 ? "done" : "plan");
      }
    },
    [],
  );

  useEffect(() => {
    if (resumeId) resume(resumeId);
    return () => {
      stopRef.current = true;
    };
  }, [resumeId, resume]);

  async function uploadRefs(files: FileList | null) {
    if (!files?.length || !projectId) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("الجلسة غير صالحة");
      for (const f of Array.from(files).slice(0, 4 - refImages.length)) {
        const ext = f.name.split(".").pop() || "png";
        const path = `${u.user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("studio").upload(path, f, { contentType: f.type });
        if (error) throw error;
        const { data: asset } = await supabase
          .from("assets")
          .insert({ project_id: projectId, kind: "image", source: "uploaded", storage_path: path, mime: f.type, size: f.size })
          .select()
          .single();
        setRefImages((r) => [...r, { id: asset!.id, url: URL.createObjectURL(f), path, mime: f.type }]);
      }
      toast.success("تم رفع الصور المرجعية");
    } catch (e: any) {
      toast.error(e.message || "تعذر رفع الصور");
    } finally {
      setBusy(false);
    }
  }

  async function makePlan() {
    setBusy(true);
    try {
      let pid = projectId;
      if (!pid) {
        const { data: proj, error } = await supabase
          .from("projects")
          .insert({ name: description.slice(0, 60) || "فيديو من وصف", kind: "generator" })
          .select()
          .single();
        if (error || !proj) throw new Error("تعذر إنشاء المشروع");
        pid = proj.id;
        setProjectId(pid);
        navigate({ to: "/generator", search: { project: pid }, replace: true });
      }
      const p = await planGenerator({ data: { projectId: pid, description, duration, assetIds: refImages.map((r) => r.id) } });
      setPlan(p);
      setScenes(p.scenes.map(() => ({ status: "pending" })));
      setStep("plan");
      toast.success("تم إنشاء خطة اللقطات — راجعها ثم ابدأ التوليد");
    } catch (e: any) {
      toast.error(e.message || "فشل إنشاء الخطة");
    } finally {
      setBusy(false);
    }
  }

  function setScene(i: number, patch: Partial<SceneState>) {
    setScenes((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function renderScene(i: number): Promise<boolean> {
    if (!plan || !projectId) return false;
    setScene(i, { status: "rendering", error: undefined });
    try {
      const scene = plan.scenes[i]!;
      // Re-attach to a still-running job for this shot (e.g. after leaving the page) instead of duplicating it.
      const existing = await findRunningSceneJob({ data: { projectId, sceneIndex: i } });
      let jobId = existing.jobId;
      if (!jobId) {
        const started = await startSceneVideo({
          data: {
            projectId,
            sceneIndex: i,
            prompt: scene.video_prompt,
            assetIds: refImages.map((r) => r.id).slice(0, 3),
            duration: scene.duration,
            aspect,
            resolution,
          },
        });
        jobId = started.jobId;
      }
      // Poll until this scene's video is stored.
      for (;;) {
        if (stopRef.current) return false;
        await new Promise((r) => setTimeout(r, 5000));
        const r = await pollJob({ data: { jobId } });
        if (r.status === "completed") break;
        if (r.status === "failed") throw new Error((r as any).error || "فشل توليد اللقطة");
      }
      const { data: va } = await supabase
        .from("assets")
        .select("id,storage_path")
        .eq("project_id", projectId)
        .eq("kind", "video")
        .eq("meta->>sceneIndex", String(i))
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const videoUrl = va ? await sign(va.storage_path) : undefined;
      setScene(i, { status: "voicing", videoUrl, videoAssetId: va?.id });

      await generateSceneVoice({
        data: { projectId, sceneIndex: i, text: scene.voiceover, voice, dialect, delivery, pace },
      });
      const { data: aa } = await supabase
        .from("assets")
        .select("id,storage_path")
        .eq("project_id", projectId)
        .eq("kind", "audio")
        .eq("meta->>sceneIndex", String(i))
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const audioUrl = aa ? await sign(aa.storage_path) : undefined;
      setScene(i, { status: "ready", audioUrl, audioAssetId: aa?.id });
      return true;
    } catch (e: any) {
      setScene(i, { status: "failed", error: e.message || "فشل التوليد" });
      return false;
    }
  }

  async function generateAll() {
    if (!plan) return;
    setStep("generating");
    stopRef.current = false;
    // Sequential rendering: the video provider queues per workspace; one at a time avoids rate limits.
    for (let i = 0; i < plan.scenes.length; i++) {
      if (stopRef.current) return;
      if (scenes[i]?.status === "ready") continue;
      await renderScene(i);
    }
    setStep("done");
    toast.success("اكتمل توليد جميع اللقطات");
  }

  async function retryScene(i: number) {
    setBusy(true);
    await renderScene(i);
    setBusy(false);
    setScenes((s) => {
      if (s.every((x) => x.status === "ready")) setStep("done");
      return s;
    });
  }

  async function downloadMerged() {
    const ready = scenes.filter((s) => s.status === "ready" && s.videoUrl);
    if (ready.length !== scenes.length || !ready.length) {
      toast.error("يجب اكتمال جميع اللقطات قبل الدمج");
      return;
    }
    setMerging("جارٍ التحضير…");
    try {
      const { mergeScenes } = await import("@/lib/merge.client");
      const blob = await mergeScenes(
        ready.map((s, idx) => ({ videoUrl: s.videoUrl!, audioUrl: s.audioUrl, duration: plan?.scenes[idx]?.duration ?? 3 })),
        (msg) => setMerging(msg),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `im-studio-${Date.now()}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل الفيديو النهائي");
    } catch (e: any) {
      toast.error(e.message || "تعذر الدمج في المتصفح — نزّل اللقطات منفصلة من الأسفل");
    } finally {
      setMerging(null);
    }
  }

  const allReady = scenes.length > 0 && scenes.every((s) => s.status === "ready");
  const selectCls = "h-11 w-full rounded-xl border border-border bg-background px-3 text-sm";

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="text-3xl font-bold">مولّد الفيديو والصوت</h1>
        <p className="mt-1 text-muted-foreground">اكتب وصفًا واحدًا، واحصل على فيديو متكامل بالتعليق الصوتي العربي.</p>
      </div>

      {/* Step 1: description & settings */}
      <section className="glass space-y-4 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-bold"><Wand2 className="h-5 w-5 text-gold" /> وصف الفيديو</h2>
        <Textarea
          placeholder="مثال: أنشئ فيديو شرح لتطبيق برق للتمويل مدته 30 ثانية، يظهر فيه هاتف ذكي فقط دون ظهور أشخاص، مع تعليق صوتي رجالي باللهجة السعودية يشرح خطوات استخدام التطبيق…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          disabled={step === "generating"}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>مدة الفيديو</Label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value) as 10 | 20 | 30)} className={selectCls} disabled={step === "generating"}>
              {GEN_DURATIONS.map((d) => (
                <option key={d.id} value={d.id}>{d.label} · {d.minShots}–{d.maxShots} لقطات</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>المقاس</Label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value as any)} className={selectCls} disabled={step === "generating"}>
              {ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>الجودة</Label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className={selectCls} disabled={step === "generating"}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>الصوت</Label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} className={selectCls} disabled={step === "generating"}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>اللهجة</Label>
            <select value={dialect} onChange={(e) => setDialect(e.target.value)} className={selectCls} disabled={step === "generating"}>
              {DIALECTS.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>أسلوب الإلقاء</Label>
            <select value={delivery} onChange={(e) => setDelivery(e.target.value)} className={selectCls} disabled={step === "generating"}>
              {DELIVERY.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>السرعة</Label>
            <select value={pace} onChange={(e) => setPace(e.target.value as any)} className={selectCls} disabled={step === "generating"}>
              <option value="slow">بطيء</option>
              <option value="normal">طبيعي</option>
              <option value="fast">سريع</option>
            </select>
          </div>
        </div>

        {/* Reference images */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>صور مرجعية (اختياري — منتج، شعار، لقطات شاشة)</Label>
            {projectId && refImages.length < 4 && (
              <label className="cursor-pointer">
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadRefs(e.target.files)} />
                <span className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                  <ImagePlus className="h-4 w-4" /> إضافة
                </span>
              </label>
            )}
          </div>
          {refImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {refImages.map((r) => (
                <div key={r.id} className="img-zoom rounded-xl">
                  <img src={r.url} alt="" className="img-zoom-inner aspect-square w-full rounded-xl object-cover" />
                </div>
              ))}
            </div>
          )}
          {!projectId && <p className="text-xs text-muted-foreground">ستتمكن من إرفاق الصور بعد إنشاء الخطة الأولى، أو اكتب الوصف وسننشئ المشروع تلقائيًا.</p>}
        </div>

        <Button variant="luxe" onClick={makePlan} disabled={busy || description.trim().length < 10 || step === "generating"} className="h-11 w-full">
          {busy && step === "describe" ? <Loader2 className="animate-spin" /> : <Sparkles />} {plan ? "أعد إنشاء الخطة" : "أنشئ خطة اللقطات"}
        </Button>
      </section>

      {/* Step 2: scene plan review */}
      {plan && (
        <section className="glass animate-fade space-y-4 rounded-2xl p-5">
          <div>
            <h2 className="text-xl font-bold text-gold">{plan.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{plan.logline}</p>
          </div>
          <div className="space-y-3">
            {plan.scenes.map((s, i) => {
              const st = scenes[i];
              return (
                <div key={i} className="glass space-y-2 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold">لقطة {i + 1}: {s.title} <span className="text-xs font-normal text-muted-foreground">({s.duration} ث)</span></p>
                    {st && step !== "describe" && step !== "plan" && (
                      <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${st.status === "ready" ? "bg-emerald-500/15 text-emerald-400" : st.status === "failed" ? "bg-red-500/15 text-red-400" : "bg-gold/15 text-gold"}`}>
                        {(st.status === "rendering" || st.status === "voicing") && <Loader2 className="h-3 w-3 animate-spin" />}
                        {STATUS_LABEL[st.status]}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                  <p className="text-sm"><span className="text-muted-foreground">التعليق الصوتي: </span>{s.voiceover}</p>
                  {s.transition && <p className="text-xs text-muted-foreground"><span className="text-gold">الانتقال: </span>{s.transition}</p>}
                  {st?.status === "failed" && (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-red-400">{st.error}</p>
                      <Button size="sm" variant="outline" onClick={() => retryScene(i)} disabled={busy}>
                        <RefreshCw className="h-3.5 w-3.5" /> إعادة توليد اللقطة
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {step === "plan" && (
            <Button variant="luxe" onClick={generateAll} disabled={busy} className="h-11 w-full">
              <Clapperboard /> ابدأ توليد الفيديو ({plan.scenes.length} {plan.scenes.length === 1 ? "لقطة" : "لقطات"} + الصوت)
            </Button>
          )}
          {step === "generating" && (
            <p className="text-center text-sm text-muted-foreground">
              جارٍ التوليد… تُولَّد اللقطات بالتتابع وقد يستغرق كل لقطة بضع دقائق. يمكنك مغادرة الصفحة والعودة لاحقًا.
            </p>
          )}
        </section>
      )}

      {/* Step 3: preview & download */}
      {scenes.some((s) => s.videoUrl) && (
        <section className="glass animate-fade space-y-4 rounded-2xl p-5">
          <h2 className="font-bold">المعاينة والتنزيل</h2>
          <ScenePlayer scenes={scenes} aspect={aspect} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="luxe" onClick={downloadMerged} disabled={!allReady || merging !== null} className="h-11 flex-1">
              {merging ? <Loader2 className="animate-spin" /> : <Download />} {merging ?? "تنزيل الفيديو النهائي (مدمج بالصوت)"}
            </Button>
          </div>
          {!allReady && <p className="text-xs text-muted-foreground">زر الدمج يُفعَّل بعد اكتمال جميع اللقطات. يمكنك تنزيل أي لقطة جاهز منفردًا:</p>}
          <div className="flex flex-wrap gap-3">
            {scenes.map(
              (s, i) =>
                s.videoUrl && (
                  <a key={i} href={s.videoUrl} download className="text-sm text-gold hover:underline">
                    تنزيل لقطة {i + 1}
                  </a>
                ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Sequential player: plays each scene's video with its voiceover in sync, auto-advancing. */
function ScenePlayer({ scenes, aspect }: { scenes: SceneState[]; aspect: "16:9" | "9:16" }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ready = scenes.map((s, i) => ({ ...s, i })).filter((s) => s.videoUrl);
  const cur = ready[Math.min(idx, ready.length - 1)];

  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => setPlaying(false));
      a?.play().catch(() => {});
    } else {
      v.pause();
      a?.pause();
    }
  }, [playing, idx]);

  if (!cur) return null;

  function onEnded() {
    if (idx < ready.length - 1) {
      setIdx(idx + 1);
    } else {
      setPlaying(false);
      setIdx(0);
    }
  }

  return (
    <div className="space-y-3">
      <div className={`relative mx-auto overflow-hidden rounded-2xl border border-border bg-black ${aspect === "9:16" ? "aspect-[9/16] max-h-[65vh]" : "aspect-video w-full"}`}>
        <video
          key={cur.videoUrl}
          ref={videoRef}
          src={cur.videoUrl}
          className="h-full w-full object-contain"
          playsInline
          onEnded={onEnded}
        />
        {cur.audioUrl && <audio key={cur.audioUrl} ref={audioRef} src={cur.audioUrl} />}
        <button
          onClick={() => setPlaying((p) => !p)}
          className="glass absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full text-foreground"
          aria-label={playing ? "إيقاف" : "تشغيل"}
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
      </div>
      <div className="flex items-center justify-center gap-2">
        {ready.map((s, j) => (
          <button
            key={s.i}
            onClick={() => {
              setIdx(j);
              setPlaying(true);
            }}
            className={`h-2 rounded-full transition-all ${j === idx ? "w-6 bg-gold" : "w-2 bg-border"}`}
            aria-label={`لقطة ${s.i + 1}`}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        لقطة {cur.i + 1} من {ready.length} {cur.audioUrl ? "· بتعليق صوتي" : "· بدون صوت بعد"}
      </p>
    </div>
  );
}
