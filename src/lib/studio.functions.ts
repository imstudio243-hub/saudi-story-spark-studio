import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MODELS,
  createVideo,
  simplifyVideoPrompt,
  minimalVideoPrompt,
  isProviderInternalError,
  downloadVideo,
  getVideo,
  listModels,
  respond,
  synthesize,
  toBase64,
} from "./ai.server";
import { AD_STYLES, voiceInstruction, type AdPlan, type GenPlan } from "./catalog";
import { requireAdminRole } from "./admin-access";

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["product", "style", "audience", "headline", "scenes", "video_prompt", "voiceover", "caption"],
  properties: {
    product: { type: "string" },
    style: { type: "string" },
    audience: { type: "string" },
    headline: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "camera", "lighting"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          camera: { type: "string" },
          lighting: { type: "string" },
        },
      },
    },
    video_prompt: { type: "string" },
    voiceover: { type: "string" },
    caption: { type: "string" },
  },
};

const PLAN_RULES = `أنت مخرج إعلانات محترف في iM STUDIO. اكتب خطة إعلان بالعربية (product, style, audience, headline, scenes, voiceover, caption) لكن اكتب video_prompt بالإنجليزية لنموذج توليد الفيديو.
قواعد video_prompt:
- مقطع واحد متواصل بمدة محددة، صف المشهد والكاميرا والإضاءة والمزاج والصوت الموسيقي.
- إذا توفرت صورة منتج فهي المرجع المطلق. ابدأ video_prompt بجملة إلزامية: "The product in <FIRST_FRAME> must remain 100% identical and unchanged throughout the entire video: exact same shape, proportions, colors, materials, label, logo, and any text on it. Do NOT redraw, redesign, reinterpret, beautify, or generate a different product. Only the camera, lighting, environment and particles around the product may move."
- ثم صف المنتج بدقة من الصورة بالإنجليزية (شكل العبوة، لونها، نوع الغطاء، نص الملصق حرفيًا) ليكون مرساة نصية تمنع الانحراف.
- الحركة حول المنتج فقط: دوران كاميرا بطيء، جزيئات، إضاءة، انعكاسات. المنتج نفسه ثابت ولا يتشوه ولا يتغير.
- لا تكتب نصوصًا على الشاشة إلا إذا اقتبست العنوان حرفيًا. "No dialogue." لأن التعليق الصوتي يُضاف لاحقًا.
- استخدم توقيتات مثل [0-3s] لتقسيم المشاهد داخل المقطع.
- أضف: "Consider micro-detail, cinematic lighting, realistic reflections and smooth camera motion."
voiceover: نص تعليق صوتي قصير يناسب المدة (حوالي كلمتين لكل ثانية).`;

async function readAsset(supabase: any, path: string) {
  const { data, error } = await supabase.storage.from("studio").download(path);
  if (error || !data) throw new Error("تعذر قراءة الملف من التخزين.");
  return toBase64(await data.arrayBuffer());
}

async function logUsage(supabase: any, userId: string, row: Record<string, unknown>) {
  await supabase.from("usage_events").insert({ user_id: userId, ...row });
}

// ---------- Ad / explainer planning ----------
export const planAd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      mode: z.enum(["images", "explainer"]),
      style: z.string(),
      duration: z.number().int().min(3).max(10),
      brief: z.string().max(6000).default(""),
      assetIds: z.array(z.string().uuid()).max(4).default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: assets } = await supabase
      .from("assets")
      .select("id, storage_path, mime")
      .eq("project_id", data.projectId)
      .in("id", data.assetIds.length ? data.assetIds : ["00000000-0000-0000-0000-000000000000"]);
    const parts: any[] = [];
    for (const a of assets ?? []) {
      parts.push({ type: "input_image", image_url: `data:${a.mime};base64,${await readAsset(supabase, a.storage_path)}` });
    }
    const styleLabel = AD_STYLES.find((s) => s.id === data.style)?.label ?? data.style;
    const ask =
      data.mode === "images"
        ? `حلّل صور المنتج المرفقة وتعرّف على المنتج والعناصر المهمة، ثم أنشئ إعلانًا. الأسلوب: ${data.style === "auto" ? "اختر الأنسب تلقائيًا واذكر السبب في style" : styleLabel}. المدة: ${data.duration} ثوانٍ. ملاحظات المستخدم: ${data.brief || "لا يوجد"}`
        : `حوّل الشرح التالي إلى فيديو تعليمي مترابط مدته ${data.duration} ثوانٍ. إذا لم تُرفق لقطات شاشة حقيقية فاجعل المشاهد توضيحية مجردة ولا تخترع واجهة تطبيق حقيقي، واذكر ذلك في caption. الشرح:\n${data.brief}`;
    parts.unshift({ type: "input_text", text: ask });
    const text = await respond({ instructions: PLAN_RULES, messages: [{ role: "user", content: parts }], schema: { name: "ad_plan", schema: planSchema } });
    const plan = JSON.parse(text) as AdPlan;
    const { data: proj } = await supabase.from("projects").select("data").eq("id", data.projectId).single();
    await supabase
      .from("projects")
      .update({ data: { ...((proj?.data as object) ?? {}), plan, planHistory: [...(((proj?.data as any)?.planHistory ?? []) as AdPlan[]), plan].slice(-10) }, updated_at: new Date().toISOString() })
      .eq("id", data.projectId);
    await logUsage(supabase, userId, { service: "planning", model: MODELS.text, units: 1, unit: "request" });
    return plan;
  });

// ---------- Video ----------
export const startVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      prompt: z.string().min(10).max(4000),
      assetIds: z.array(z.string().uuid()).max(3).default([]),
      duration: z.number().int().min(3).max(10),
      aspect: z.enum(["16:9", "9:16"]),
      resolution: z.enum(["720p", "1080p"]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: assets } = await supabase
      .from("assets")
      .select("storage_path, mime")
      .eq("project_id", data.projectId)
      .in("id", data.assetIds.length ? data.assetIds : ["00000000-0000-0000-0000-000000000000"]);
    const images = [];
    for (const a of assets ?? []) images.push({ data: await readAsset(supabase, a.storage_path), mime: a.mime });
    const { data: job, error } = await supabase
      .from("generation_jobs")
      .insert({ user_id: userId, project_id: data.projectId, kind: "video", status: "queued", model: MODELS.video, input: { ...data } })
      .select()
      .single();
    if (error || !job) throw new Error("تعذر إنشاء مهمة التوليد.");
    try {
      const fidelity = images.length
        ? "STRICT PRODUCT FIDELITY: The attached image(s) show the exact real product. Reproduce it pixel-faithfully — identical shape, colors, label, logo and text. Never invent, morph or replace the product. Animate only the camera, light and surroundings.\n\n"
        : "";
      const v = await createVideo({ prompt: fidelity + data.prompt, images, duration: data.duration, aspect: data.aspect, resolution: data.resolution });
      await supabase.from("generation_jobs").update({ provider_job_id: v.id, status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);
      return { jobId: job.id };
    } catch (e: any) {
      await supabase.from("generation_jobs").update({ status: "failed", error: e.message, updated_at: new Date().toISOString() }).eq("id", job.id);
      throw e;
    }
  });

export const pollJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase.from("generation_jobs").select("*").eq("id", data.jobId).single();
    if (!job) throw new Error("المهمة غير موجودة.");
    if (job.status !== "running" || !job.provider_job_id) return { status: job.status, error: job.error };
    const v = await getVideo(job.provider_job_id);
    if (v.status === "failed") {
      const msg = v.error?.message || "فشل توليد الفيديو.";
      const prev = job.input as any;
      // Automatic recovery on the same job row: first a simplified prompt, then a
      // minimal safe prompt. Reference images are kept in both retries.
      if (isProviderInternalError(msg) && typeof prev?.prompt === "string" && !prev?.minimal) {
        try {
          const images = [];
          if (Array.isArray(prev.assetIds) && prev.assetIds.length) {
            const { data: assets } = await supabase
              .from("assets")
              .select("storage_path, mime")
              .in("id", prev.assetIds);
            for (const a of assets ?? []) images.push({ data: await readAsset(supabase, a.storage_path), mime: a.mime });
          }
          const secondAttempt = Boolean(prev.simplified);
          const prompt = secondAttempt ? await minimalVideoPrompt(prev.prompt) : await simplifyVideoPrompt(prev.prompt);
          const retry = await createVideo({ prompt, images, duration: prev.duration, aspect: prev.aspect, resolution: prev.resolution });
          await supabase
            .from("generation_jobs")
            .update({ provider_job_id: retry.id, input: { ...prev, prompt, originalPrompt: prev.originalPrompt ?? prev.prompt, simplified: true, ...(secondAttempt ? { minimal: true } : {}) }, error: null, updated_at: new Date().toISOString() })
            .eq("id", job.id);
          return { status: "running", progress: null, simplified: true };
        } catch {
          /* fall through and report the original failure */
        }
      }
      await supabase.from("generation_jobs").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { status: "failed", error: msg };
    }
    if (v.status !== "completed") return { status: "running", progress: v.progress ?? null };
    // Claim completion once to avoid double storage/billing on concurrent polls.
    const { data: claimed } = await supabase
      .from("generation_jobs")
      .update({ status: "saving", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running")
      .select("id");
    if (!claimed?.length) return { status: "saving" };
    try {
      const bytes = await downloadVideo(job.provider_job_id);
      const path = `${userId}/${job.project_id}/${crypto.randomUUID()}.mp4`;
      const up = await supabase.storage.from("studio").upload(path, bytes, { contentType: "video/mp4" });
      if (up.error) throw new Error("تعذر حفظ الفيديو في التخزين.");
      const input = job.input as any;
      const { data: asset } = await supabase
        .from("assets")
        .insert({ user_id: userId, project_id: job.project_id!, kind: "video", source: "generated", storage_path: path, mime: "video/mp4", size: bytes.byteLength, meta: { duration: input.duration, aspect: input.aspect, resolution: input.resolution, jobId: job.id, ...(input.sceneIndex !== undefined ? { sceneIndex: input.sceneIndex } : {}) } })
        .select()
        .single();
      await supabase.from("generation_jobs").update({ status: "completed", output_asset_id: asset?.id ?? null, updated_at: new Date().toISOString() }).eq("id", job.id);
      await logUsage(supabase, userId, { job_id: job.id, service: "video", model: MODELS.video, units: input.duration, unit: "second" });
      return { status: "completed" };
    } catch (e: any) {
      await supabase.from("generation_jobs").update({ status: "running", error: e.message }).eq("id", job.id);
      throw e;
    }
  });

// ---------- Voice ----------
async function makeVoice(supabase: any, userId: string, p: { projectId: string; text: string; voice: string; dialect: string; delivery: string; pace: string; sceneIndex?: number }) {
  const { data: job } = await supabase
    .from("generation_jobs")
    .insert({ user_id: userId, project_id: p.projectId, kind: "voice", status: "running", model: MODELS.speech, input: p })
    .select()
    .single();
  try {
    const wav = await synthesize(`${voiceInstruction(p.dialect, p.delivery, p.pace)}\n${p.text}`, p.voice);
    if (wav.byteLength < 1000) throw new Error("لم يُرجع مزود الصوت ملفًا صالحًا.");
    const path = `${userId}/${p.projectId}/${crypto.randomUUID()}.wav`;
    const up = await supabase.storage.from("studio").upload(path, wav, { contentType: "audio/wav" });
    if (up.error) throw new Error("تعذر حفظ الصوت.");
    const { data: asset } = await supabase
      .from("assets")
      .insert({ user_id: userId, project_id: p.projectId, kind: "audio", source: "generated", storage_path: path, mime: "audio/wav", size: wav.byteLength, meta: { voice: p.voice, dialect: p.dialect, delivery: p.delivery, pace: p.pace, text: p.text, ...(p.sceneIndex !== undefined ? { sceneIndex: p.sceneIndex } : {}) } })
      .select()
      .single();
    if (!asset || !job) throw new Error("تعذر حفظ بيانات الصوت.");
    await supabase.from("generation_jobs").update({ status: "completed", output_asset_id: asset.id, updated_at: new Date().toISOString() }).eq("id", job.id);
    await logUsage(supabase, userId, { job_id: job.id, service: "voice", model: MODELS.speech, units: p.text.length, unit: "char" });
    return asset;
  } catch (e: any) {
    await supabase.from("generation_jobs").update({ status: "failed", error: e.message, updated_at: new Date().toISOString() }).eq("id", job.id);
    throw e;
  }
}

const voiceInput = z.object({
  projectId: z.string().uuid(),
  text: z.string().min(2).max(3000),
  voice: z.string().min(2).max(30),
  dialect: z.string(),
  delivery: z.string(),
  pace: z.enum(["slow", "normal", "fast"]),
});

export const generateVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(voiceInput)
  .handler(async ({ data, context }) => {
    const asset = await makeVoice(context.supabase, context.userId, data);
    return { assetId: asset.id as string };
  });

// ---------- iM AI ----------
const actionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "action"],
  properties: {
    reply: { type: "string" },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["type", "project_name", "project_kind", "voice_text", "voice", "dialect", "delivery"],
      properties: {
        type: { type: "string", enum: ["none", "create_project", "generate_voice"] },
        project_name: { type: ["string", "null"] },
        project_kind: { type: ["string", "null"], enum: ["ad", "explainer", "voice", null] },
        voice_text: { type: ["string", "null"] },
        voice: { type: ["string", "null"] },
        dialect: { type: ["string", "null"], enum: ["saudi", "najdi", "hijazi", "fusha", null] },
        delivery: { type: ["string", "null"], enum: ["ad", "luxury", "hype", "tutorial", null] },
      },
    },
  },
};

const AI_RULES = `أنت iM AI، مساعد منصة iM STUDIO لصناعة الإعلانات والفيديو والصوت. تفهم العربية واللهجة السعودية وترد بنفس لهجة المستخدم باختصار ووضوح.
الأدوات الحقيقية المتاحة لك عبر الحقل action:
- create_project: ينشئ مشروعًا فعليًا (project_kind: ad لإعلان من صور، explainer لتحويل شرح إلى فيديو، voice لصوت). استخدمه عندما يطلب المستخدم إنشاء إعلان أو فيديو أو مشروع. إذا أرفق صورة فستُضاف تلقائيًا إلى المشروع.
- generate_voice: يولد تعليقًا صوتيًا فعليًا. voice أحد: Orus (فهد رجالي رزين), Charon (ليث رجالي واضح), Fenrir (حماسي), Algenib (عميق), Puck (مرح), Kore (نسائي واثق), Sulafat (نسائي دافئ), Aoede (هادئ), Zephyr (مشرق).
قواعد صارمة: لا تقل إنك نفذت شيئًا إلا إذا اخترت action مناسبًا؛ النظام هو من ينفذ ويُبلغ النتيجة. توليد الفيديو نفسه يبدأ من صفحة المشروع بعد مراجعة السيناريو، فوضح ذلك. لا تحذف أي شيء. إذا لم يلزم إجراء فاختر none واترك الحقول null.`;

export const chatSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      text: z.string().min(1).max(8000),
      image: z.object({ data: z.string().max(7_000_000), mime: z.enum(["image/png", "image/jpeg", "image/webp"]) }).nullable().default(null),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: hist } = await supabase.from("chat_messages").select("role, content").order("created_at", { ascending: false }).limit(16);
    const history = (hist ?? []).reverse().map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
    await supabase.from("chat_messages").insert({ user_id: userId, role: "user", content: data.text + (data.image ? "\n[📎 صورة مرفقة]" : "") });
    const userParts: any[] = [{ type: "input_text", text: data.text }];
    if (data.image) userParts.push({ type: "input_image", image_url: `data:${data.image.mime};base64,${data.image.data}` });
    const raw = await respond({ instructions: AI_RULES, messages: [...history, { role: "user", content: userParts }], schema: { name: "im_ai", schema: actionSchema } });
    const out = JSON.parse(raw) as { reply: string; action: any };
    await logUsage(supabase, userId, { service: "chat", model: MODELS.text, units: 1, unit: "request" });

    let result: { type: string; ok: boolean; message: string; projectId?: string } = { type: "none", ok: true, message: "" };
    try {
      if (out.action.type === "create_project") {
        const { data: proj, error } = await supabase
          .from("projects")
          .insert({ user_id: userId, name: out.action.project_name || "مشروع جديد", kind: out.action.project_kind || "ad" })
          .select()
          .single();
        if (error) throw new Error(error.message);
        if (!proj) throw new Error("تعذر إنشاء المشروع.");
        if (data.image) {
          const ext = data.image.mime.split("/")[1];
          const path = `${userId}/${proj.id}/${crypto.randomUUID()}.${ext}`;
          const bin = Uint8Array.from(atob(data.image.data), (c) => c.charCodeAt(0));
          await supabase.storage.from("studio").upload(path, bin, { contentType: data.image.mime });
          await supabase.from("assets").insert({ user_id: userId, project_id: proj.id, kind: "image", storage_path: path, mime: data.image.mime, size: bin.byteLength });
        }
        result = { type: "create_project", ok: true, message: `تم إنشاء المشروع «${proj.name}»`, projectId: proj.id };
      } else if (out.action.type === "generate_voice" && out.action.voice_text) {
        const { data: proj } = await supabase.from("projects").insert({ user_id: userId, name: "صوت من iM AI", kind: "voice" }).select().single();
        if (!proj) throw new Error("تعذر إنشاء المشروع.");
        await makeVoice(supabase, userId, {
          projectId: proj.id,
          text: out.action.voice_text,
          voice: out.action.voice || "Orus",
          dialect: out.action.dialect || "saudi",
          delivery: out.action.delivery || "ad",
          pace: "normal",
        });
        result = { type: "generate_voice", ok: true, message: "تم توليد الصوت وحفظه في مشروع جديد", projectId: proj.id };
      }
    } catch (e: any) {
      result = { type: out.action.type, ok: false, message: `فشل التنفيذ: ${e.message}` };
    }
    await supabase.from("chat_messages").insert({ user_id: userId, role: "assistant", content: out.reply, action: result.type === "none" ? null : result });
    return { reply: out.reply, action: result.type === "none" ? null : result };
  });

// ---------- Admin ----------
async function assertAdmin(supabase: any, userId: string) {
  await requireAdminRole(supabase, userId);
}

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminRole(context.supabase, context.userId);
    const [usage, jobs, users] = await Promise.all([
      context.supabase.from("usage_events").select("service,units,unit,created_at").order("created_at", { ascending: false }).limit(100),
      context.supabase.from("generation_jobs").select("id,kind,status,model,error,created_at").order("created_at", { ascending: false }).limit(50),
      context.supabase.from("profiles").select("id", { count: "exact", head: true }),
    ]);
    for (const result of [usage, jobs, users]) if (result.error) throw new Error("تعذر تحميل بيانات الإدارة.");
    return { usage: usage.data ?? [], jobs: jobs.data ?? [], users: users.count ?? 0 };
  });

export const testServices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const services = [
      { name: "المحادثة والتخطيط وتحليل الصور", task: "text", model: MODELS.text },
      { name: "توليد الفيديو", task: "video", model: MODELS.video },
      { name: "توليد الصوت", task: "speech", model: MODELS.speech },
    ];
    try {
      const ids = await listModels();
      return services.map((s) => ({ ...s, ok: ids.includes(s.model), error: ids.includes(s.model) ? null : "النموذج غير متاح لمساحة العمل" }));
    } catch (e: any) {
      return services.map((s) => ({ ...s, ok: false, error: e.message as string }));
    }
  });

// ---------- AI Video & Voice Generator (text → multi-scene video + voiceover) ----------
const genPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "logline", "scenes"],
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "video_prompt", "voiceover", "duration", "transition"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          video_prompt: { type: "string" },
          voiceover: { type: "string" },
          duration: { type: "number" },
          transition: { type: "string" },
        },
      },
    },
  },
};

const GEN_RULES = `أنت مخرج فيديو محترف في iM STUDIO. مهمتك تحويل وصف المستخدم إلى خطة فيديو متكاملة بالصوت.
أخرج title وlogline وscenes بالعربية، لكن video_prompt لكل مشهد بالإنجليزية لنموذج توليد الفيديو.

قاعدة الالتزام بالموضوع (أولوية قصوى):
- افهم وصف المستخدم حرفيًا. كل مشهد يجب أن يخدم الموضوع نفسه من البداية للنهاية. ممنوع الانتقال لموضوع آخر أو إضافة مشاهد عامة لا علاقة لها بالطلب.
- إذا حدد المستخدم قيودًا (مثل: بدون ظهور أشخاص، هاتف فقط، منتج معين) فالتزم بها في كل مشهد وفي كل video_prompt حرفيًا، وكرر القيد داخل كل موجه.
- إذا طلب المستخدم شرح تطبيق أو موقع حقيقي ولم تُرفق لقطات شاشة حقيقية: لا تخترع واجهات أو أزرارًا وتعرضها كأنها التطبيق الحقيقي. اجعل المشاهد توضيحية مجردة (هاتف، عناصر مجردة، نصوص) واذكر في description أن المشهد تصوري.
- إذا أُرفقت صور مرجعية فهي المرجع المطلق: ابدأ كل video_prompt بجملة إلزامية: "The subject in <FIRST_FRAME> must remain 100% identical and unchanged throughout the entire clip: exact same shape, proportions, colors, materials, label, logo, and any text on it. Do NOT redraw, redesign, reinterpret, or generate a different subject. Only the camera, lighting, environment and particles around it may move."

قواعد video_prompt لكل مشهد:
- مقطع واحد متواصل بمدة المشهد المحددة. صف المشهد والكاميرا والإضاءة والمزاج والموسيقى التصويرية المناسبة.
- اكتب "No dialogue." لأن التعليق الصوتي يُركَّب لاحقًا.
- المشاهد مترابطة: كل مشهد يكمل الذي قبله ويخدم الهدف النهائي، مع انتقال منطقي بينها.
- أضف: "Consider micro-detail, cinematic lighting, realistic reflections and smooth camera motion."

قواعد voiceover لكل لقطة:
- نص تعليق صوتي عربي يشرح ما يظهر في اللقطة نفسها بالتزامن معها.
- الطول: حوالي كلمتين لكل ثانية من مدة اللقطة، لا أكثر، حتى يتسع الصوت للمدة دون تسريع مزعج.
- كل لقطة جملة قصيرة مكتملة المعنى، والتعليق كله موزع على كامل المدة دون قطع كلمات، ويلتزم بموضوع الوصف ولا يخرج عنه.

قواعد التقطيع والجودة:
- قسّم الفيديو إلى لقطات قصيرة متنوعة (زوايا وحركات كاميرا وأحجام لقطات مختلفة) تخدم الموضوع نفسه، بترتيب منطقي من جذب الانتباه إلى الخاتمة، دون تكرار ممل أو لقطات حشو.
- حافظ على هوية بصرية واحدة عبر كل اللقطات: كرّر في كل video_prompt الوصف نفسه حرفيًا للعناصر الثابتة (شكل الجهاز أو المنتج، الألوان، الإضاءة، اسم العلامة كما كتبه المستخدم).
- ممنوع اختراع شعارات أو واجهات تطبيقات أو أرقام أو معلومات مالية غير موجودة في وصف المستخدم.
- النص الظاهر على الشاشة: سطر واحد على الأكثر في الفيديو كله، ويكون اسم العلامة أو العنوان كما كتبه المستخدم حرفيًا بالعربية الصحيحة.
- تحقق قبل الإخراج: كل لقطة مرتبطة بموضوع الوصف، الترتيب منطقي، مجموع المدد يساوي المدة المطلوبة بالضبط.

قواعد الاستمرارية السينمائية بين اللقطات (حقل transition لكل لقطة):
- الفيديو يجب أن يبدو عملًا واحدًا متصلًا، لا لقطات منفصلة. لكل لقطة اكتب في transition: كيف تبدأ اللقطة من الحالة التي انتهت عندها السابقة، وكيف تنتهي ممهدةً للقطة التالية (مثال: "تنتهي باقتراب الكاميرا من الشاشة حتى يملأ الضوء الأزرق الإطار، وتبدأ التالية بخروج الكاميرا من هذا الضوء").
- اربط نهاية كل لقطة ببداية التالية بحركة كاميرا مستمرة أو عنصر بصري مشترك (ضوء، عنصر داخل المشهد، حركة جانبية، دوران). نوّع أسلوب الانتقال بين اللقطات ولا تكرر الحركة نفسها.
- في video_prompt: ابدأ كل لقطة (عدا الأولى) بوصف حالة الافتتاح المستمرة من نهاية السابقة، واختم كل لقطة (عدا الأخيرة) بحركة الخروج الممهدة. لا تعد ضبط الكاميرا أو العناصر إلى نقطة البداية دون سبب.
- حافظ على الشخصيات والعناصر نفسها (الملامح، الملابس، الألوان، الإضاءة، الخلفية) عبر اللقطات، وكرر وصفها حرفيًا في كل video_prompt.
- اللقطة الأولى تبدأ جذبًا للانتباه، والأخيرة تنتهي بخاتمة متكاملة تكشف العلامة.`;

// ---------- Reference video style analysis ----------
const STYLE_RULES = `أنت محلل أسلوب فيديوهات إعلانية في iM STUDIO. ستصلك لقطات (إطارات) مرتبة زمنيًا من فيديو مرجعي أرفقه المستخدم.
حلّلها وأخرج «موجز أسلوب» عربيًا مكثفًا يصف بدقة:
1. الشخصيات: الملامح، الشعر، الملابس، الألوان، أسلوب الرسم (كرتوني ثنائي/ثلاثي الأبعاد/واقعي)، ووصفًا إنجليزيًا دقيقًا للشخصية يصلح للصقه حرفيًا في موجه توليد فيديو.
2. الهوية البصرية: الألوان السائدة، الخلفيات، الإضاءة، المزاج العام.
3. النصوص على الشاشة: أسلوب العناوين، مواضعها، الشريط السفلي للكتابة المتزامنة مع الكلام إن وجد.
4. التنقلات والإيقاع: كيف تنتقل المشاهد، سرعة الإيقاع، حركات الكاميرا أو الحركة الرسومية.
5. أسلوب الكلام: اللهجة، النبرة، طول الجمل، طريقة مخاطبة الجمهور.
اكتب الموجز بالعربية، وأدرج داخله فقرة بعنوان CHARACTER_EN: تصف الشخصية بالإنجليزية في 40 كلمة كحد أقصى. لا تتجاوز 250 كلمة إجمالًا.`;

export const analyzeReferenceVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ projectId: z.string().uuid(), assetIds: z.array(z.string().uuid()).min(2).max(8) }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: assets } = await supabase
      .from("assets")
      .select("id, storage_path, mime, meta")
      .eq("project_id", data.projectId)
      .in("id", data.assetIds);
    const frames = (assets ?? [])
      .filter((a) => (a.meta as any)?.refRole === "video-frame")
      .sort((a, b) => ((a.meta as any)?.frameAt ?? 0) - ((b.meta as any)?.frameAt ?? 0));
    if (frames.length < 2) throw new Error("لم تُعثر على إطارات الفيديو المرجعي.");
    const parts: any[] = [
      { type: "input_text", text: `هذه ${frames.length} إطارات مرتبة زمنيًا من فيديو مرجعي واحد. حلّل أسلوبه وفق التعليمات.` },
    ];
    for (const f of frames) {
      parts.push({ type: "input_image", image_url: `data:${f.mime};base64,${await readAsset(supabase, f.storage_path)}` });
    }
    const brief = (await respond({ instructions: STYLE_RULES, messages: [{ role: "user", content: parts }] })).slice(0, 3000);
    const { data: proj } = await supabase.from("projects").select("data").eq("id", data.projectId).single();
    await supabase
      .from("projects")
      .update({ data: { ...((proj?.data as object) ?? {}), styleBrief: brief }, updated_at: new Date().toISOString() })
      .eq("id", data.projectId);
    await logUsage(supabase, userId, { service: "style_analysis", model: MODELS.text, units: 1, unit: "request" });
    return { brief };
  });

export const planGenerator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      description: z.string().min(10).max(6000),
      voice: z.string().default("Orus"),
      dialect: z.string().default("saudi"),
      delivery: z.string().default("ad"),
      pace: z.enum(["slow", "normal", "fast"]).default("normal"),
      aspect: z.enum(["16:9", "9:16"]).default("9:16"),
      resolution: z.enum(["720p", "1080p"]).default("720p"),
      duration: z.union([z.literal(10), z.literal(20), z.literal(30)]),
      assetIds: z.array(z.string().uuid()).max(4).default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Economy mode: fewest, longest clips the video model allows (each clip costs credits).
    const range = ({ 10: [1, 2], 20: [2, 3], 30: [3, 4] } as Record<number, [number, number]>)[data.duration]!;
    const { data: assets } = await supabase
      .from("assets")
      .select("id, storage_path, mime")
      .eq("project_id", data.projectId)
      .in("id", data.assetIds.length ? data.assetIds : ["00000000-0000-0000-0000-000000000000"]);
    const parts: any[] = [];
    for (const a of assets ?? []) {
      parts.push({ type: "input_image", image_url: `data:${a.mime};base64,${await readAsset(supabase, a.storage_path)}` });
    }
    const { data: projData } = await supabase.from("projects").select("data").eq("id", data.projectId).single();
    const styleBrief = (projData?.data as any)?.styleBrief as string | undefined;
    parts.unshift({
      type: "input_text",
      text: `أنشئ خطة فيديو من ${range[0]} إلى ${range[1]} لقطة قصيرة مترابطة ومتنوعة (المدة الإجمالية ${data.duration} ثانية بالضبط). مدة كل لقطة بين 3 و10 ثوانٍ، ومجموع مدد اللقطات يساوي ${data.duration} بالضبط. وزّع القصة والتعليق الصوتي على اللقطات كاملة بشكل متناسق.\n\nوصف المستخدم (التزم به حرفيًا):\n${data.description}${styleBrief ? `\n\nموجز أسلوب الفيديو المرجعي (قلّده بالكامل: الشخصية نفسها، الألوان، أسلوب النصوص على الشاشة، التنقلات، الإيقاع، وأسلوب الكلام — مع تغيير الموضوع إلى موضوع المستخدم فقط):\n${styleBrief}\n\nالتزامات إلزامية عند وجود موجز الأسلوب:\n- الصق وصف CHARACTER_EN حرفيًا في بداية كل video_prompt لضمان ثبات الشخصية 100% عبر اللقطات.\n- استخدم أسلوب النصوص والشريط السفلي نفسه في توجيه المشاهد، ووزّع التعليق الصوتي بأسلوب الكلام نفسه (اللهجة والنبرة وطول الجمل).\n- اجعل transition لكل لقطة يحاكي تنقلات الفيديو المرجعي.` : ""}`,
    });
    const text = await respond({ instructions: GEN_RULES, messages: [{ role: "user", content: parts }], schema: { name: "gen_plan", schema: genPlanSchema } });
    const plan = JSON.parse(text) as GenPlan;
    // Server-side verification: clamp shot count and normalize durations to sum exactly to the requested total.
    let scenes = plan.scenes.slice(0, range[1]);
    while (scenes.length > range[0] && Math.floor(data.duration / scenes.length) < 3) scenes.pop();
    if (scenes.length < 1) throw new Error("لم يُنتج النموذج خطة لقطات صالحة. أعد المحاولة.");
    const n = scenes.length;
    // Shots overlap by 0.5s crossfades at merge time, so plan slightly longer to land on the requested total.
    const target = data.duration + Math.round((n - 1) * 0.5);
    const base = Math.max(3, Math.floor(target / n));
    const rem = target - base * n;
    plan.scenes = scenes.map((s, i) => ({ ...s, duration: base + (i >= n - rem ? 1 : 0) }));
    const { data: proj } = await supabase.from("projects").select("data").eq("id", data.projectId).single();
    await supabase
      .from("projects")
      .update({ data: { ...((proj?.data as object) ?? {}), genPlan: plan, genSettings: { duration: data.duration, voice: data.voice, dialect: data.dialect, delivery: data.delivery, pace: data.pace, aspect: data.aspect, resolution: data.resolution } }, updated_at: new Date().toISOString() })
      .eq("id", data.projectId);
    await logUsage(supabase, userId, { service: "planning", model: MODELS.text, units: 1, unit: "request" });
    return plan;
  });

export const startSceneVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      sceneIndex: z.number().int().min(0).max(14),
      prompt: z.string().min(10).max(4000),
      assetIds: z.array(z.string().uuid()).max(3).default([]),
      duration: z.number().int().min(3).max(10),
      aspect: z.enum(["16:9", "9:16"]),
      resolution: z.enum(["720p", "1080p"]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: assets } = await supabase
      .from("assets")
      .select("storage_path, mime")
      .eq("project_id", data.projectId)
      .in("id", data.assetIds.length ? data.assetIds : ["00000000-0000-0000-0000-000000000000"]);
    const images = [];
    for (const a of assets ?? []) images.push({ data: await readAsset(supabase, a.storage_path), mime: a.mime });
    const { data: job, error } = await supabase
      .from("generation_jobs")
      .insert({ user_id: userId, project_id: data.projectId, kind: "video", status: "queued", model: MODELS.video, input: { ...data } })
      .select()
      .single();
    if (error || !job) throw new Error("تعذر إنشاء مهمة التوليد.");
    try {
      const fidelity = images.length
        ? "STRICT SUBJECT FIDELITY: The attached image(s) show the exact real subject. Reproduce it pixel-faithfully — identical shape, colors, label, logo and text. Never invent, morph or replace it. Animate only the camera, light and surroundings.\n\n"
        : "";
      const v = await createVideo({ prompt: fidelity + data.prompt, images, duration: data.duration, aspect: data.aspect, resolution: data.resolution });
      await supabase.from("generation_jobs").update({ provider_job_id: v.id, status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);
      return { jobId: job.id };
    } catch (e: any) {
      await supabase.from("generation_jobs").update({ status: "failed", error: e.message, updated_at: new Date().toISOString() }).eq("id", job.id);
      throw e;
    }
  });

/** Find a still-running video job for a scene so a reopened page re-attaches instead of duplicating. */
export const findRunningSceneJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ projectId: z.string().uuid(), sceneIndex: z.number().int().min(0).max(14) }))
  .handler(async ({ data, context }) => {
    const { data: job } = await context.supabase
      .from("generation_jobs")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("kind", "video")
      .eq("status", "running")
      .eq("input->>sceneIndex", String(data.sceneIndex))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { jobId: (job?.id as string | undefined) ?? null };
  });

export const generateSceneVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(voiceInput.extend({ sceneIndex: z.number().int().min(0).max(14) }))
  .handler(async ({ data, context }) => {
    const asset = await makeVoice(context.supabase, context.userId, data);
    return { assetId: asset.id as string };
  });
