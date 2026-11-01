import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MODELS,
  createVideo,
  downloadVideo,
  getVideo,
  listModels,
  respond,
  synthesize,
  toBase64,
} from "./ai.server";
import { AD_STYLES, voiceInstruction, type AdPlan, type GenPlan } from "./catalog";

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
        .insert({ user_id: userId, project_id: job.project_id!, kind: "video", source: "generated", storage_path: path, mime: "video/mp4", size: bytes.byteLength, meta: { duration: input.duration, aspect: input.aspect, resolution: input.resolution, jobId: job.id } })
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
      .insert({ user_id: userId, project_id: p.projectId, kind: "audio", source: "generated", storage_path: path, mime: "audio/wav", size: wav.byteLength, meta: { voice: p.voice, dialect: p.dialect, delivery: p.delivery, text: p.text.slice(0, 500), ...(p.sceneIndex !== undefined ? { sceneIndex: p.sceneIndex } : {}) } })
      .select()
      .single();
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
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("غير مصرح: هذه الصفحة للمدير فقط.");
}

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
        required: ["title", "description", "video_prompt", "voiceover", "duration"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          video_prompt: { type: "string" },
          voiceover: { type: "string" },
          duration: { type: "number" },
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

قواعد voiceover لكل مشهد:
- نص تعليق صوتي عربي يشرح ما يظهر في المشهد نفسه بالتزامن معه.
- الطول: حوالي كلمتين لكل ثانية من مدة المشهد، لا أكثر، حتى يتسع الصوت للمدة.
- التعليق كله يلتزم بموضوع الوصف ولا يخرج عنه.`;

export const planGenerator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      description: z.string().min(10).max(6000),
      duration: z.union([z.literal(10), z.literal(20), z.literal(30)]),
      assetIds: z.array(z.string().uuid()).max(4).default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sceneCount = data.duration / 10;
    const sceneLen = data.duration / sceneCount;
    const { data: assets } = await supabase
      .from("assets")
      .select("id, storage_path, mime")
      .eq("project_id", data.projectId)
      .in("id", data.assetIds.length ? data.assetIds : ["00000000-0000-0000-0000-000000000000"]);
    const parts: any[] = [];
    for (const a of assets ?? []) {
      parts.push({ type: "input_image", image_url: `data:${a.mime};base64,${await readAsset(supabase, a.storage_path)}` });
    }
    parts.unshift({
      type: "input_text",
      text: `أنشئ خطة فيديو من ${sceneCount} ${sceneCount === 1 ? "مشهد" : "مشاهد"}، مدة كل مشهد ${sceneLen} ثوانٍ بالضبط (المدة الإجمالية ${data.duration} ثانية). وزّع القصة والتعليق الصوتي على المشاهد بشكل متناسق. اكتب رقم المدة في حقل duration لكل مشهد = ${sceneLen}.\n\nوصف المستخدم (التزم به حرفيًا):\n${data.description}`,
    });
    const text = await respond({ instructions: GEN_RULES, messages: [{ role: "user", content: parts }], schema: { name: "gen_plan", schema: genPlanSchema } });
    const plan = JSON.parse(text) as GenPlan;
    plan.scenes = plan.scenes.slice(0, sceneCount).map((s) => ({ ...s, duration: sceneLen }));
    const { data: proj } = await supabase.from("projects").select("data").eq("id", data.projectId).single();
    await supabase
      .from("projects")
      .update({ data: { ...((proj?.data as object) ?? {}), genPlan: plan, genSettings: { duration: data.duration } }, updated_at: new Date().toISOString() })
      .eq("id", data.projectId);
    await logUsage(supabase, userId, { service: "planning", model: MODELS.text, units: 1, unit: "request" });
    return plan;
  });

export const startSceneVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      sceneIndex: z.number().int().min(0).max(9),
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

export const generateSceneVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(voiceInput.extend({ sceneIndex: z.number().int().min(0).max(9) }))
  .handler(async ({ data, context }) => {
    const asset = await makeVoice(context.supabase, context.userId, data);
    return { assetId: asset.id as string };
  });
