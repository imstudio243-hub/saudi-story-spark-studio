// Browser-safe catalog of options that the connected services actually support.

export const AD_STYLES = [
  { id: "auto", label: "اختر الأسلوب تلقائيًا" },
  { id: "luxury", label: "إعلان فاخر" },
  { id: "perfume", label: "عطور وعود" },
  { id: "tech", label: "إعلان تقني" },
  { id: "app", label: "تطبيق أو موقع" },
  { id: "store", label: "متجر إلكتروني" },
  { id: "tiktok", label: "سريع لـ TikTok" },
  { id: "reels", label: "Instagram Reels" },
  { id: "shorts", label: "YouTube Shorts" },
  { id: "cinematic", label: "سينمائي" },
  { id: "3d", label: "ثلاثي الأبعاد" },
  { id: "realistic", label: "تجاري واقعي" },
  { id: "minimal", label: "نظيف وبسيط" },
  { id: "features", label: "شرح مميزات المنتج" },
  { id: "story", label: "قصة قصيرة" },
  { id: "campaign", label: "حملة تسويقية" },
] as const;

// Gemini Omni video: 3–10s, 16:9 or 9:16, 720p / 1080p (4K exists but is costly; not offered).
export const DURATIONS = [4, 6, 8, 10] as const;

// AI Video & Voice Generator: total durations split into shots (model: 3–10s per clip).
// Economy mode: the fewest, longest clips the model allows, since each clip costs ~2.2 credits.
export const GEN_DURATIONS = [
  { id: 10, label: "10 ثوانٍ", minShots: 1, maxShots: 2 },
  { id: 20, label: "20 ثانية", minShots: 2, maxShots: 3 },
  { id: 30, label: "30 ثانية", minShots: 3, maxShots: 4 },
] as const;

export type GenScene = {
  title: string;
  description: string;
  video_prompt: string;
  voiceover: string;
  duration: number;
  transition: string;
};

export type GenPlan = {
  title: string;
  logline: string;
  scenes: GenScene[];
};
export const ASPECTS = [
  { id: "9:16", label: "عمودي 9:16 (تيك توك/ريلز)" },
  { id: "16:9", label: "أفقي 16:9 (يوتيوب)" },
] as const;
export const RESOLUTIONS = ["720p", "1080p"] as const;

// Gemini TTS prebuilt voices (synthetic, licensed through the provider).
export const VOICES = [
  { id: "Orus", label: "فهد — رجالي رزين", gender: "m" },
  { id: "Charon", label: "ليث — رجالي إخباري واضح", gender: "m" },
  { id: "Fenrir", label: "ماجد — رجالي حماسي", gender: "m" },
  { id: "Algenib", label: "سلطان — رجالي عميق", gender: "m" },
  { id: "Puck", label: "نواف — رجالي مرح", gender: "m" },
  { id: "Kore", label: "نورة — نسائي واثق", gender: "f" },
  { id: "Sulafat", label: "ريم — نسائي دافئ", gender: "f" },
  { id: "Aoede", label: "لمى — نسائي هادئ", gender: "f" },
  { id: "Zephyr", label: "سارة — نسائي مشرق", gender: "f" },
] as const;

export const DIALECTS = [
  { id: "saudi", label: "سعودي (لهجة بيضاء)", instr: "باللهجة السعودية البيضاء" },
  { id: "najdi", label: "نجدي", instr: "باللهجة النجدية السعودية" },
  { id: "hijazi", label: "حجازي", instr: "باللهجة الحجازية" },
  { id: "fusha", label: "عربي فصيح", instr: "بالعربية الفصحى" },
] as const;

export const DELIVERY = [
  { id: "ad", label: "إعلاني رسمي", instr: "بنبرة إعلانية واثقة ورسمية" },
  { id: "luxury", label: "فاخر (عطور)", instr: "بنبرة فاخرة هادئة وعميقة وببطء أنيق" },
  { id: "hype", label: "حماسي تسويقي", instr: "بنبرة حماسية سريعة ومليئة بالطاقة" },
  { id: "tutorial", label: "شرح تقني", instr: "بنبرة واضحة وودودة مناسبة للشروحات" },
] as const;

export function voiceInstruction(dialect: string, delivery: string, pace: string) {
  const d = DIALECTS.find((x) => x.id === dialect) ?? DIALECTS[0];
  const s = DELIVERY.find((x) => x.id === delivery) ?? DELIVERY[0];
  const p = pace === "slow" ? "وبسرعة بطيئة" : pace === "fast" ? "وبسرعة أعلى قليلًا" : "وبسرعة طبيعية";
  return `اقرأ النص التالي ${d.instr} ${s.instr} ${p}:`;
}

export type AdPlan = {
  product: string;
  style: string;
  audience: string;
  headline: string;
  scenes: { title: string; description: string; camera: string; lighting: string }[];
  video_prompt: string;
  voiceover: string;
  caption: string;
};
