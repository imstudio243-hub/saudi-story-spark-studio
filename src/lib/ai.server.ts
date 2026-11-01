// Server-only helpers for Lovable AI Gateway calls (chat/vision, video, speech).
const BASE = "https://ai.gateway.lovable.dev/v1";

export const MODELS = {
  text: "openai/gpt-6-astra",
  video: "google/gemini-omni-1.1-flash",
  speech: "google/gemini-3.1-flash-tts-preview",
} as const;

function key() {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("خدمة الذكاء الاصطناعي غير مهيأة (المفتاح غير موجود).");
  return k;
}

function headers(json = true) {
  const k = key();
  const h: Record<string, string> = {
    Authorization: `Bearer ${k}`,
    "Lovable-API-Key": k,
    "X-Lovable-AIG-SDK": "fetch",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export class GatewayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function failure(res: Response): Promise<never> {
  let msg = "";
  try {
    const j = await res.json();
    msg = j?.error?.message || j?.message || "";
  } catch {
    /* ignore */
  }
  const friendly: Record<number, string> = {
    402: "نفد رصيد الذكاء الاصطناعي في مساحة العمل. أضف رصيدًا ثم أعد المحاولة.",
    429: "الخدمة مشغولة حاليًا. انتظر قليلًا ثم أعد المحاولة.",
    401: "إعداد مفتاح خدمة الذكاء الاصطناعي غير صحيح.",
  };
  throw new GatewayError(res.status, friendly[res.status] || msg || `فشل طلب الخدمة (${res.status})`);
}

export function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

/** Streams a Responses call server-side and returns the final text. */
export async function respond(opts: {
  instructions: string;
  messages: { role: "user" | "assistant"; content: string | Part[] }[];
  schema?: { name: string; schema: Record<string, unknown> };
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODELS.text,
    instructions: opts.instructions,
    input: opts.messages.map((m) =>
      m.role === "assistant"
        ? { role: "assistant", content: [{ type: "output_text", text: m.content as string }] }
        : { role: "user", content: typeof m.content === "string" ? [{ type: "input_text", text: m.content }] : m.content },
    ),
    stream: true,
    store: false,
    reasoning: { effort: "low" },
  };
  if (opts.schema) {
    body.text = { format: { type: "json_schema", name: opts.schema.name, schema: opts.schema.schema, strict: true } };
  }
  const res = await fetch(`${BASE}/responses`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok || !res.body) return failure(res);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let done = false;
  while (!done) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
      else if (ev.type === "response.completed") done = true;
      else if (ev.type === "response.failed" || ev.type === "error") {
        throw new GatewayError(500, ev.response?.error?.message || ev.error?.message || ev.message || "فشل توليد الرد");
      }
    }
  }
  if (!text.trim()) throw new GatewayError(500, "لم يُرجع النموذج أي نص (قد يكون الطلب مرفوضًا).");
  return text;
}

// ---------- Video ----------
export async function createVideo(input: {
  prompt: string;
  images: { data: string; mime: string }[];
  duration: number;
  aspect: "16:9" | "9:16";
  resolution: "720p" | "1080p";
}) {
  const parts: unknown[] = [{ type: "text", text: input.prompt }];
  for (const im of input.images) parts.push({ type: "image", data: im.data, mime_type: im.mime });
  const res = await fetch(`${BASE}/videos`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: MODELS.video,
      input: input.images.length ? parts : input.prompt,
      response_format: {
        type: "video",
        resolution: input.resolution,
        duration: `${input.duration}s`,
        aspect_ratio: input.aspect,
      },
    }),
  });
  if (!res.ok) return failure(res);
  return (await res.json()) as { id: string; status: string };
}

export async function getVideo(id: string) {
  const res = await fetch(`${BASE}/videos/${id}`, { headers: headers(false) });
  if (!res.ok) return failure(res);
  return (await res.json()) as { id: string; status: string; progress?: number; error?: { message?: string } };
}

export async function downloadVideo(id: string) {
  const res = await fetch(`${BASE}/videos/${id}/content`, { headers: headers(false) });
  if (!res.ok) return failure(res);
  return res.arrayBuffer();
}

// ---------- Speech ----------
export async function synthesize(text: string, voice: string) {
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: MODELS.speech,
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
      stream_format: "audio",
    }),
  });
  if (!res.ok) return failure(res);
  return res.arrayBuffer();
}

export async function listModels() {
  const res = await fetch(`${BASE}/models`, { headers: headers(false) });
  if (!res.ok) return failure(res);
  const j = await res.json();
  return (j.data as { id: string }[]).map((m) => m.id);
}
