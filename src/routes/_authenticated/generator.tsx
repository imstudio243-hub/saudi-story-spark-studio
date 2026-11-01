import { useServerFn } from "@tanstack/react-start";
import { captionCues, sceneReady } from "@/lib/narration-timeline";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Download, ImagePlus, Loader2, Pause, Play, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { planGenerator, startSceneVideo, generateSceneVoice, pollJob, findRunningSceneJob } from "@/lib/studio.functions";
import { ASPECTS, DELIVERY, DIALECTS, GEN_DURATIONS, RESOLUTIONS, VOICES, type GenPlan } from "@/lib/catalog";
import { formatCredits, planTotalCredits, sceneTotalCredits } from "@/lib/gen-cost";
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
  voice?: string;
  dialect?: string;
  delivery?: string;
  pace?: string;
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
  const planFn = useServerFn(planGenerator);
  const startFn = useServerFn(startSceneVideo);
  const voiceFn = useServerFn(generateSceneVoice);
  const pollFn = useServerFn(pollJob);
  const runningFn = useServerFn(findRunningSceneJob);
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

  // Resume an existing generator project. Returns the restored scene states so the
  // caller can auto-continue unfinished work without waiting for React state.
  const resume = useCallback(
    async (id: string): Promise<{ states: SceneState[]; plan: GenPlan } | null> => {
      const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
      if (!p) return null;
      const gp = (p.data as any)?.genPlan as GenPlan | undefined;
      const gs = (p.data as any)?.genSettings as { duration?: number; voice?: string; dialect?: string; delivery?: string; pace?: "slow" | "normal" | "fast"; aspect?: "16:9" | "9:16"; resolution?: "720p" | "1080p" } | undefined;
      if (gs?.duration) setDuration(gs.duration as 10 | 20 | 30);
      if (gs?.voice) setVoice(gs.voice);
      if (gs?.dialect) setDialect(gs.dialect);
      if (gs?.delivery) setDelivery(gs.delivery);
      if (gs?.pace) setPace(gs.pace);
      if (gs?.aspect) setAspect(gs.aspect);
      if (gs?.resolution) setResolution(gs.resolution);
      const { data: assets } = await supabase
        .from("assets")
        .select("id,kind,mime,storage_path,meta")
        .eq("project_id", id)
        .order("created_at", { ascending: false });
      const refs: RefImage[] = [];
      const byScene = new Map<number, SceneState>();
      const { data: jobs } = await supabase.from("generation_jobs").select("kind,status,error,input").eq("project_id", id).order("created_at", { ascending: false });
      const latestVideo = new Map<number, { status: string; error: string | null }>();
      for (const job of jobs ?? []) {
        const index = (job.input as any)?.sceneIndex;
        if (job.kind === "video" && typeof index === "number" && !latestVideo.has(index)) latestVideo.set(index, job);
      }
      for (const a of assets ?? []) {
        const url = await sign(a.storage_path);
        if (a.kind === "image") refs.push({ id: a.id, url, path: a.storage_path, mime: a.mime });
        const idx = (a.meta as any)?.sceneIndex;
        if (idx === undefined || idx === null) continue;
        const cur = byScene.get(idx) ?? { status: "pending" as const };
        if (a.kind === "video" && !cur.videoUrl) Object.assign(cur, { videoUrl: url, videoAssetId: a.id });
        if (a.kind === "audio" && !cur.audioUrl) Object.assign(cur, { audioUrl: url, audioAssetId: a.id, voice: (a.meta as any)?.voice, dialect: (a.meta as any)?.dialect, delivery: (a.meta as any)?.delivery, pace: (a.meta as any)?.pace });
        byScene.set(idx, cur);
      }
      setRefImages(refs);
      if (gp) {
        setPlan(gp);
        const states = gp.scenes.map((_, i) => {
          const s = byScene.get(i);
          if (s && sceneReady(s)) return { ...s, status: "ready" as const };
          const job = latestVideo.get(i);
          if (job?.status === "failed") return { ...s, status: "failed" as const, error: job.error === "Internal error encountered." ? "تعطلت خدمة الفيديو أثناء إنشاء هذه اللقطة؛ أعد محاولة هذه اللقطة فقط." : job.error ?? "تعذر إنشاء اللقطة" };
          return { ...s, status: "pending" as const };
        });
        setScenes(states);
        setStep(states.every((s) => s.status === "ready") && states.length > 0 ? "done" : "plan");
        return { states, plan: gp };
      }
      return null;
    },
    [],
  );

  // generateAll is assigned to a ref so the resume effect can auto-continue work.
  const generateAllRef = useRef<((p?: GenPlan, states?: SceneState[]) => Promise<void>) | null>(null);

  useEffect(() => {
    stopRef.current = false;
    if (resumeId) {
      // Leaving the page never cancels provider-side jobs; on return, re-attach to
      // running jobs and continue the remaining scenes automatically.
      void resume(resumeId).then((states) => {
        if (states?.some((s) => s.status !== "ready")) generateAllRef.current?.();
      });
    }
    return () => {
      stopRef.current = true;
    };
  }, [resumeId, resume]);

  // If the user switches away mid-generation and comes back, restart the polling loop.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && projectId && !busy) {
        void resume(projectId).then((states) => {
          if (states?.some((s) => s.status !== "ready")) generateAllRef.current?.();
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [projectId, busy, resume]);

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
        if (!asset) throw new Error("تعذر حفظ الصورة");
        setRefImages((r) => [...r, { id: asset.id, url: URL.createObjectURL(f), path, mime: f.type }]);
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
      const p = await planFn({ data: { projectId: pid, description, duration, assetIds: refImages.map((r) => r.id), voice, dialect, delivery, pace, aspect, resolution } });
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

  async function saveSettings() {
    if (!projectId) return;
    const { data: project, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
    if (error) throw error;
    const { error: updateError } = await supabase.from("projects").update({ data: { ...((project?.data as object) ?? {}), genSettings: { duration, voice, dialect, delivery, pace, aspect, resolution } } }).eq("id", projectId);
    if (updateError) throw updateError;
  }

  async function renderScene(i: number, voiceOnly = false): Promise<boolean> {
    const scene = plan?.scenes[i];
    if (!scene || !projectId) return false;
    const current = scenes[i];
    setScene(i, { status: current?.videoUrl ? "voicing" : "rendering", error: undefined });
    // Begin speech while the single-video queue renders, instead of waiting twice.
    const narration = (async () => {
      const matches = current?.audioUrl && current.voice === voice && current.dialect === dialect && current.delivery === delivery && current.pace === pace;
      if (matches && !voiceOnly) return current;
      const result = await voiceFn({ data: { projectId, sceneIndex: i, text: scene.voiceover, voice, dialect, delivery, pace } });
      const { data: asset, error } = await supabase.from("assets").select("storage_path").eq("id", result.assetId).single();
      if (error || !asset) throw new Error("تعذر تحميل التعليق الصوتي.");
      const audioUrl = await sign(asset.storage_path);
      if (!audioUrl) throw new Error("تعذر تشغيل التعليق الصوتي.");
      const patch = { audioUrl, audioAssetId: result.assetId, voice, dialect, delivery, pace };
      setScene(i, patch);
      return patch;
    })();
    // Observe rejection immediately, while video is still rendering.
    const audioResult = narration.then((data) => ({ data, error: null }), (error: Error) => ({ data: null, error }));
    try {
      let videoUrl = current?.videoUrl;
      if (!videoUrl) {
        const existing = await runningFn({ data: { projectId, sceneIndex: i } });
        const jobId = existing.jobId ?? (await startFn({ data: { projectId, sceneIndex: i, prompt: scene.video_prompt, assetIds: refImages.map((r) => r.id).slice(0, 3), duration: scene.duration, aspect, resolution } })).jobId;
        for (;;) {
          if (stopRef.current) return false;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const result = await pollFn({ data: { jobId } });
          if (result.status === "completed") break;
          if (result.status === "failed") throw new Error(result.error === "Internal error encountered." ? "تعطلت خدمة الفيديو أثناء إنشاء هذه اللقطة. اللقطات الناجحة محفوظة؛ يمكنك إعادة محاولة هذه اللقطة فقط." : result.error || "فشل توليد اللقطة");
        }
        const { data: asset } = await supabase.from("assets").select("id,storage_path").eq("project_id", projectId).eq("kind", "video").eq("meta->>sceneIndex", String(i)).order("created_at", { ascending: false }).limit(1).single();
        videoUrl = asset ? await sign(asset.storage_path) : undefined;
        if (!videoUrl) throw new Error("تعذر تحميل الفيديو.");
        setScene(i, { videoUrl, videoAssetId: asset?.id, status: "voicing" });
      }
      const audio = await audioResult;
      if (audio.error) throw audio.error;
      setScene(i, { ...audio.data, videoUrl, status: "ready" });
      return true;
    } catch (e: any) {
      setScene(i, { status: "failed", error: e.message || "فشل التوليد" });
      return false;
    }
  }

  async function generateAll(p: GenPlan | undefined = plan, states: SceneState[] | undefined = undefined) {
    const activePlan = p ?? plan;
    if (!activePlan || busy) return;
    setBusy(true);
    setStep("generating");
    stopRef.current = false;
    try {
      await saveSettings();
      let complete = true;
      for (let i = 0; i < activePlan.scenes.length; i++) {
        if (stopRef.current) return;
        const known = states?.[i] ?? scenes[i];
        if (known?.status === "ready" && known?.voice === voice && known?.dialect === dialect && known?.delivery === delivery && known?.pace === pace) continue;
        if (!await renderScene(i)) { complete = false; break; }
      }
      setStep("done");
      if (complete) toast.success("اكتمل الفيديو والتعليق الصوتي");
      else toast.error("لم يكتمل التوليد؛ راجع اللقطة المتعثرة");
    } catch (e: any) {
      setStep("plan");
      toast.error(e.message);
    } finally { setBusy(false); }
  }
  generateAllRef.current = generateAll;

  async function retryScene(i: number, voiceOnly = false) {
    if (busy) return;
    setBusy(true);
    try { await saveSettings(); await renderScene(i, voiceOnly); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function downloadMerged() {
    if (!allReady || !plan) { toast.error("أكمل الفيديو والصوت لكل اللقطات أولًا"); return; }
    setMerging("جارٍ التحضير…");
    try {
      const { mergeScenes } = await import("@/lib/merge-scenes");
      const inputs = scenes.flatMap((s, i) => s.videoUrl ? [{ videoUrl: s.videoUrl, audioUrl: s.audioUrl, duration: plan.scenes[i]?.duration ?? 3, voiceover: plan.scenes[i]?.voiceover ?? "" }] : []);
      const blob = await mergeScenes(inputs, setMerging);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `im-studio-${Date.now()}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success("تم تنزيل الفيديو بالصوت والكتابة");
    } catch (e: any) { toast.error(e.message || "تعذر حفظ الفيديو"); }
    finally { setMerging(null); }
  }

  const allReady = scenes.length > 0 && scenes.every((s) => s.status === "ready" && sceneReady(s));
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
                <option key={d.id} value={d.id}>{d.label} · {d.minShots}–{d.maxShots} لقطات · ~{formatCredits(planTotalCredits([{ duration: d.id }], "720p"))} رصيد</option>
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
                    <p className="font-bold">لقطة {i + 1}: {s.title} <span className="text-xs font-normal text-muted-foreground">({s.duration} ث · ~{formatCredits(sceneTotalCredits(s.duration, resolution))} رصيد فيديو + صوت)</span></p>
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
                  {st?.status === "pending" && step !== "generating" && <Button size="sm" variant="outline" disabled={busy} onClick={() => retryScene(i)}><Play className="h-3.5 w-3.5" /> إنشاء لقطة {i + 1}</Button>}
                </div>
              );
            })}
          </div>
          {(step === "plan" || (step === "done" && !allReady)) && (
            <div className="space-y-2">
              <Button variant="luxe" onClick={generateAll} disabled={busy} className="h-11 w-full">
                <Clapperboard /> {step === "done" ? "استكمال اللقطات المتبقية والصوت" : `ابدأ توليد الفيديو (${plan.scenes.length} لقطات + الصوت)`}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                التكلفة التقديرية: ~{formatCredits(planTotalCredits(plan.scenes, resolution))} رصيد ({resolution === "720p" ? "جودة 720p الاقتصادية" : "جودة 1080p الأعلى تكلفة"}) — وضع اقتصادي تلقائي: أقل عدد لقطات بأطول مدة يدعمها النموذج.
              </p>
            </div>
          )}
          {allReady && (
            <Button variant="luxe" onClick={downloadMerged} disabled={merging !== null} className="h-12 w-full">
              {merging ? <Loader2 className="animate-spin" /> : <Download />} {merging ?? `دمج اللقطات (${plan.scenes.length}) بالترتيب مع الصوت في فيديو واحد`}
            </Button>
          )}
          {step === "generating" && (
            <p className="text-center text-sm text-muted-foreground">
              جارٍ توليد الفيديو والتعليق الصوتي…
            </p>
          )}
        </section>
      )}

      {/* Step 3: preview & download */}
      {scenes.some((s) => s.videoUrl) && (
        <section className="glass animate-fade space-y-4 rounded-2xl p-5">
          <h2 className="font-bold">المعاينة والتنزيل</h2>
          <ScenePlayer scenes={scenes} aspect={aspect} plan={plan} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="luxe" onClick={downloadMerged} disabled={!allReady || merging !== null} className="h-11 flex-1">
              {merging ? <Loader2 className="animate-spin" /> : <Download />} {merging ?? "تنزيل الفيديو بالصوت والكتابة"}
            </Button>
          </div>
          {!allReady && <p className="text-xs text-muted-foreground">زر الدمج يُفعَّل بعد اكتمال جميع اللقطات. يمكنك تنزيل أي لقطة جاهز منفردًا:</p>}
          <div className="flex flex-wrap gap-3">
            {scenes.map(
              (s, i) =>
                s.videoUrl && (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <a href={s.videoUrl} download className="text-sm text-gold hover:underline">لقطة {i + 1} (دون التعليق)</a>
                    {s.audioUrl && <a href={s.audioUrl} download className="text-sm text-gold hover:underline">التعليق الصوتي {i + 1}</a>}
                    <Button size="sm" variant="outline" disabled={busy || merging !== null} onClick={() => retryScene(i, true)}><RefreshCw className="h-3 w-3" /> {s.audioUrl ? "تحديث الصوت المختار" : "إنشاء الصوت المختار"}</Button>
                  </div>
                ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Preview uses narration as the clock so short source clips cannot cut off speech. */
function ScenePlayer({ scenes, aspect, plan }: { scenes: SceneState[]; aspect: "16:9" | "9:16"; plan: GenPlan | null }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ready = scenes.map((s, i) => ({ ...s, i })).filter((s) => s.videoUrl);
  const cur = ready[Math.min(idx, ready.length - 1)];
  const videoUrl = cur?.videoUrl;
  const audioUrl = cur?.audioUrl;

  async function playMedia() {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || !audioUrl) { toast.error("التعليق الصوتي لم يكتمل بعد"); setPlaying(false); return; }
    try {
      // A source codec failure must not hide the separately generated Arabic narration.
      const videoPlayback = v.play().catch(() => { toast.error("تعذر تشغيل صورة المقطع في هذا المتصفح؛ يمكنك سماع التعليق وتنزيل الفيديو النهائي."); });
      await a.play();
      await videoPlayback;
    } catch { v.pause(); a.pause(); setPlaying(false); toast.error("اضغط تشغيل للسماح بالصوت، أو أعد تحميل التعليق"); }
  }

  useEffect(() => {
    setTime(0);
    setAudioDuration(0);
    if (playing) void playMedia();
  }, [videoUrl, audioUrl]);

  useEffect(() => () => { videoRef.current?.pause(); audioRef.current?.pause(); }, []);

  function toggle() {
    if (playing) { videoRef.current?.pause(); audioRef.current?.pause(); setPlaying(false); }
    else { setPlaying(true); void playMedia(); }
  }

  if (!cur) return null;
  const cues = captionCues(plan?.scenes[cur.i]?.voiceover ?? "", 0, audioDuration);
  const caption = playing ? cues.find((c) => time >= c.start && time < c.end)?.text : undefined;
  function advance() {
    const v = videoRef.current;
    const a = audioRef.current;
    if ((!v?.ended && !v?.error) || !a?.ended) return;
    if (idx < ready.length - 1) setIdx(idx + 1);
    else { setPlaying(false); setIdx(0); if (v) v.currentTime = 0; if (a) a.currentTime = 0; }
  }

  return (
    <div className="space-y-3">
      <div className={`relative mx-auto overflow-hidden rounded-2xl border border-border bg-background ${aspect === "9:16" ? "aspect-[9/16] max-h-[65vh]" : "aspect-video w-full"}`}>
        <video key={videoUrl} ref={videoRef} src={videoUrl} muted className="h-full w-full object-contain" playsInline preload="auto" onEnded={advance} onWaiting={() => audioRef.current?.pause()} onPlaying={() => { if (playing && audioRef.current?.paused) void audioRef.current.play().catch(() => setPlaying(false)); }} />
        {audioUrl && <audio key={audioUrl} ref={audioRef} src={audioUrl} preload="auto" onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)} onTimeUpdate={(e) => { setTime(e.currentTarget.currentTime); const v = videoRef.current; if (v && !v.ended && Math.abs(v.currentTime - e.currentTarget.currentTime) > 0.25) v.currentTime = Math.min(e.currentTarget.currentTime, v.duration || 0); }} onEnded={advance} onError={() => { setPlaying(false); toast.error("تعذر تحميل التعليق الصوتي؛ أعد إنشاءه"); }} />}
        {caption && <div dir="rtl" data-testid="video-caption" className="video-caption absolute bottom-[16%] left-[6%] right-[6%] rounded-md px-3 py-2 text-lg">{caption}</div>}
        <Button variant="outline" size="icon" disabled={!audioUrl} onClick={toggle} className="absolute bottom-3 right-3 h-11 w-11 rounded-full" aria-label={playing ? "إيقاف" : "تشغيل بالصوت"}>{playing ? <Pause /> : <Play />}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {ready.map((s, j) => <Button key={s.i} variant={j === idx ? "default" : "outline"} size="sm" aria-label={`لقطة ${s.i + 1}`} onClick={() => { videoRef.current?.pause(); audioRef.current?.pause(); setPlaying(false); setIdx(j); }}>{s.i + 1}</Button>)}
      </div>
      <p className="text-center text-xs text-muted-foreground">لقطة {cur.i + 1} من {plan?.scenes.length ?? scenes.length} · الجاهز {ready.length} {audioUrl ? `· ${VOICES.find((v) => v.id === cur.voice)?.label ?? "تعليق عربي"}` : "· التعليق الصوتي غير مكتمل"}</p>
    </div>
  );
}
