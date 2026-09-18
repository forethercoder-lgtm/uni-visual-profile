import { geminiJson } from "./gemini";
import { USER_AGENT } from "./http";
import { fetchOfficialSitePages } from "./officialSite";
import type { Resolved } from "./resolveUniversity";
import {
  Activity,
  ActivityKind,
  Evidence,
  Faculty,
  Insights,
  Level,
} from "./types";

// ---------- Understanding misspelled / abbreviated names ----------

export interface QueryInterpretation {
  status: "confident" | "ambiguous" | "unknown";
  name: string | null;
  alternatives: string[];
  question: string | null;
}

// Wikidata's search is prefix-based and not typo-tolerant, so "nazarbaev
// univercity", "КазНУ" or "MGU" find nothing. The model maps such input to a
// real institution; the result is then re-validated against Wikidata, so a
// hallucinated name can't produce a fake profile. When it isn't sure it says
// so and the UI asks the user instead of guessing.
export async function interpretQuery(
  rawQuery: string
): Promise<QueryInterpretation | null> {
  const prompt = `Пользователь ввёл название учебного заведения (университет, колледж, институт, техникум, академия) — возможно с ошибками, в сокращении, в транслите или на другом языке: "${rawQuery}".
Определи, какое именно заведение имелось в виду.
Ответь JSON: {"status": "confident" | "ambiguous" | "unknown", "name": "официальное название заведения (на английском или на родном языке, как в Wikipedia)" или null, "alternatives": ["до 4 официальных названий других возможных вариантов"], "question": "короткий уточняющий вопрос пользователю на русском" или null}
Правила:
- "confident" — только если ты уверен, что такое заведение существует и имелось в виду именно оно.
- "ambiguous" — если сокращение или название подходит нескольким заведениям: перечисли их в alternatives и задай вопрос.
- "unknown" — если не знаешь такого заведения: name = null, в question попроси указать полное название, город или страну.
- Никогда не выдумывай несуществующие заведения.`;

  const out = await geminiJson<Partial<QueryInterpretation>>(prompt, 15000);
  if (!out || !out.status) return null;
  const status =
    out.status === "confident" || out.status === "ambiguous" ? out.status : "unknown";
  return {
    status,
    name: typeof out.name === "string" && out.name.trim() ? out.name.trim() : null,
    alternatives: Array.isArray(out.alternatives)
      ? out.alternatives
          .filter((a): a is string => typeof a === "string" && !!a.trim())
          .slice(0, 4)
      : [],
    question: typeof out.question === "string" ? out.question.trim() : null,
  };
}

// ---------- Faculties, popularity, load, student activities ----------

async function fetchWikipediaText(
  title: string,
  lang: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const pages = Object.values(json.query?.pages ?? {}) as { extract?: string }[];
    const text = pages[0]?.extract?.trim();
    return text ? text.slice(0, 9000) : null;
  } catch {
    return null;
  }
}

const LEVELS: Level[] = ["high", "medium", "low"];
const KINDS: ActivityKind[] = [
  "club", "event", "sport", "volunteering", "culture", "science", "other",
];

const asLevel = (v: unknown): Level | null =>
  LEVELS.includes(v as Level) ? (v as Level) : null;
const asEvidence = (v: unknown): Evidence =>
  v === "source" ? "source" : "ai_estimate";
const asText = (v: unknown, max = 220): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const asCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

interface RawInsights {
  faculties?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
  overallLoad?: { level?: unknown; note?: unknown } | null;
}

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "официальный сайт";
  } catch {
    return "официальный сайт";
  }
}

export async function buildInsights(
  resolved: Resolved
): Promise<Insights | null> {
  const [wikiText, sitePages] = await Promise.all([
    resolved.wikiTitle && resolved.wikiLang
      ? fetchWikipediaText(resolved.wikiTitle, resolved.wikiLang)
      : Promise.resolve(null),
    resolved.officialWebsite
      ? fetchOfficialSitePages(resolved.officialWebsite)
      : Promise.resolve([]),
  ]);

  const sources: Insights["sources"] = [];
  if (wikiText && resolved.wikiUrl)
    sources.push({ label: "Wikipedia", url: resolved.wikiUrl });
  for (const p of sitePages) {
    sources.push({ label: `Сайт вуза: ${pathLabel(p.url)}`, url: p.url });
  }

  const sourceBlock = [
    wikiText ? `### Wikipedia\n${wikiText}` : "",
    ...sitePages.map((p) => `### Официальный сайт: ${p.url}\n${p.text}`),
    resolved.studentCount
      ? `### Wikidata\nЧисло студентов: ${resolved.studentCount}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `Ты помогаешь абитуриенту понять студенческую жизнь и факультеты заведения "${resolved.resolvedName}"${
    resolved.city
      ? ` (${resolved.city}${resolved.country ? ", " + resolved.country : ""})`
      : ""
  }.

Ниже тексты из источников (могут быть пустыми):
${sourceBlock || "(источников нет)"}

Верни JSON строго такой формы:
{
 "faculties": [{"name": "название факультета/школы", "popularity": "high"|"medium"|"low"|null, "load": "high"|"medium"|"low"|null, "students": число или null, "note": "1 короткое предложение по-русски", "evidence": "source"|"ai_estimate"}],
 "activities": [{"title": "название", "kind": "club"|"event"|"sport"|"volunteering"|"culture"|"science"|"other", "description": "1 короткое предложение по-русски", "evidence": "source"|"ai_estimate"}],
 "overallLoad": {"level": "high"|"medium"|"low"|null, "note": "1 предложение"} или null
}
Значения полей:
- popularity — спрос среди абитуриентов (конкурс, число заявок, известность направления).
- load — загруженность: сколько студентов приходится на факультет и насколько напряжённая учебная нагрузка.
- evidence относится к самому факультету/активности: "source" — только если он прямо назван в текстах выше; "ai_estimate" — если ты знаешь о нём из общих знаний.
- popularity и load — ВСЕГДА твоя оценка (в источниках их обычно нет). Различай факультеты: не ставь всем "high". Если нет уверенности — null.
Жёсткие правила честности:
- Не выдумывай. Если не знаешь заведение или данных нет — верни пустые массивы, а popularity/load/students поставь null.
- Не более 8 факультетов и 8 активностей. Названия клубов и мероприятий — только реально упомянутые в источниках или заведомо известные.`;

  const raw = await geminiJson<RawInsights>(prompt, 30000);
  if (!raw) return null;

  const faculties: Faculty[] = (raw.faculties ?? [])
    .map((f) => ({
      name: asText(f.name, 120),
      popularity: asLevel(f.popularity),
      load: asLevel(f.load),
      students: asCount(f.students),
      note: asText(f.note),
      evidence: asEvidence(f.evidence),
    }))
    .filter((f) => f.name)
    .slice(0, 8);

  const activities: Activity[] = (raw.activities ?? [])
    .map((a) => ({
      title: asText(a.title, 120),
      kind: KINDS.includes(a.kind as ActivityKind)
        ? (a.kind as ActivityKind)
        : ("other" as ActivityKind),
      description: asText(a.description),
      evidence: asEvidence(a.evidence),
    }))
    .filter((a) => a.title)
    .slice(0, 8);

  const overallLoad = raw.overallLoad
    ? { level: asLevel(raw.overallLoad.level), note: asText(raw.overallLoad.note) }
    : null;

  if (faculties.length === 0 && activities.length === 0 && !overallLoad?.note) {
    return null;
  }

  return {
    faculties,
    activities,
    overallLoad: overallLoad?.level || overallLoad?.note ? overallLoad : null,
    studentCount: resolved.studentCount,
    sources,
  };
}
