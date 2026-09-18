import { fetchWithUA } from "./http";
import { Category, fetchableUrl, ImageCandidate, VerifiedImage } from "./types";

const VALID_CATEGORIES: Category[] = [
  "campus",
  "dorms",
  "classrooms",
  "library",
  "city",
  "sports",
  "labs",
  "student_life",
];

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const BATCH_SIZE = 6;
const BATCH_CONCURRENCY = 4;

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY не задан в .env.local");
  return key;
}

interface VerifyResult {
  index: number;
  relevant: boolean;
  category: string;
  confidence: number;
  note: string;
  caption?: string;
}

async function fetchImageAsBase64(
  url: string
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetchWithUA(url, 8000);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { data: buf.toString("base64"), mimeType: contentType };
  } catch {
    return null;
  }
}

// Gemini's per-call latency (~3-4s) barely depends on how many images are in
// the call, so verifying images one-by-one wastes most of the 30s budget on
// round-trip overhead. Batching N images into a single request amortizes
// that cost across all of them.
async function verifyImageBatch(
  batch: ImageCandidate[],
  universityName: string,
  city: string | null
): Promise<(VerifiedImage | null)[]> {
  const apiKey = requireApiKey();
  const model = process.env.GEMINI_VISION_MODEL || DEFAULT_MODEL;

  const fetched = await Promise.all(
    batch.map((c) => fetchImageAsBase64(fetchableUrl(c)))
  );

  // Images that failed to download (dead link, throttled, corrupt) are left
  // out of the request entirely rather than sent as broken data.
  const included: { candidate: ImageCandidate; slot: number }[] = [];
  const parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  > = [];

  fetched.forEach((img, i) => {
    if (!img) return;
    const slot = included.length;
    included.push({ candidate: batch[i], slot });
    parts.push({ text: `Image ${slot}:` });
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  });

  if (included.length === 0) return batch.map(() => null);

  const intro = `You verify whether each photo genuinely depicts "${universityName}"${
    city ? ` located in ${city}` : ""
  }, and classify each into exactly one category from: campus, dorms, classrooms, library, city, sports, labs, student_life.
"city" means a general photo of the city itself (skyline, streets, landmarks) rather than the university. "campus" means general exterior/building/architecture shots of the institution when no more specific category fits.
There are ${included.length} images below, labeled "Image 0" through "Image ${
    included.length - 1
  }" in order.
Respond ONLY with a compact JSON array of ${included.length} objects, one per image, in the same order: [{"index": 0, "relevant": boolean, "category": "one of the categories above", "confidence": number between 0 and 1, "note": "short reason in Russian", "caption": "1-2 sentence summary in Russian of what is actually shown in the photo (building, place, activity), no speculation"}, ...].
Be conservative: if you cannot confirm the location/institution from an image, or it's a generic photo of a similar building, stock photography, or unrelated content, set relevant=false or a low confidence (<0.4). Only give confidence above 0.7 when there is a clear visual/textual cue (signage, distinctive architecture you recognize, caption match).`;

  try {
    const res = await fetch(
      `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: intro }, ...parts] }],
          generationConfig: { temperature: 0 },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[gemini] batch HTTP ${res.status}: ${body.slice(0, 300)}`);
      return batch.map(() => null);
    }
    const json = await res.json();
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJsonArray(text);
    if (!parsed) {
      console.error(`[gemini] failed to parse JSON array from: ${text.slice(0, 300)}`);
      return batch.map(() => null);
    }

    const bySlot = new Map<number, VerifyResult>();
    for (const entry of parsed) {
      if (typeof entry?.index === "number") bySlot.set(entry.index, entry);
    }

    const output: (VerifiedImage | null)[] = batch.map(() => null);
    for (const { candidate, slot } of included) {
      const result = bySlot.get(slot);
      if (!result) continue;
      const category = VALID_CATEGORIES.includes(result.category as Category)
        ? (result.category as Category)
        : candidate.category;
      const originalIndex = batch.indexOf(candidate);
      output[originalIndex] = {
        ...candidate,
        category,
        confidence: clamp01(result.confidence),
        verificationNote: result.note ?? "",
        caption: result.caption?.trim() || undefined,
      };
    }
    return output;
  } catch (err) {
    console.error(`[gemini] batch threw: ${err instanceof Error ? err.message : err}`);
    return batch.map(() => null);
  }
}

export async function verifyBatch(
  candidates: ImageCandidate[],
  universityName: string,
  city: string | null
): Promise<VerifiedImage[]> {
  const batches: ImageCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  const results: VerifiedImage[] = [];
  let index = 0;

  async function worker() {
    while (index < batches.length) {
      const i = index++;
      const verified = await verifyImageBatch(
        batches[i],
        universityName,
        city
      );
      for (const v of verified) if (v) results.push(v);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, worker)
  );

  return results;
}

export async function generateDescription(
  universityName: string,
  city: string | null,
  wikiSummary: string | null,
  officialSiteSummary: string | null,
  socialHandles: string[] = []
): Promise<string> {
  const apiKey = requireApiKey();
  const model = process.env.GEMINI_TEXT_MODEL || DEFAULT_MODEL;
  const fallback = wikiSummary ?? officialSiteSummary ?? "Описание недоступно.";

  // Wikipedia has no article for most of the world's universities, so the
  // official site's own meta description is treated as an equally valid
  // independent source — not a fallback of last resort.
  const prompt = `Напиши краткое (3-4 предложения) описание университета "${universityName}"${
    city ? ` в городе ${city}` : ""
  } на русском языке для абитуриента. Используй только факты из источников ниже (можно использовать оба, если они не противоречат друг другу), ничего не выдумывай. Если источников мало или их нет — честно скажи, что информации недостаточно, не приукрашивай.

Источник 1 (Wikipedia):
${wikiSummary ?? "нет данных"}

Источник 2 (официальный сайт университета):
${officialSiteSummary ?? "нет данных"}${
    socialHandles.length
      ? `\n\nОфициальные аккаунты в соцсетях (известен только факт их наличия, содержимое не известно): ${socialHandles.join(", ")}`
      : ""
  }`;

  try {
    const res = await fetch(
      `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
      }
    );
    if (!res.ok) return fallback;
    const json = await res.json();
    const text: string =
      json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function extractJsonArray(text: string): VerifyResult[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
