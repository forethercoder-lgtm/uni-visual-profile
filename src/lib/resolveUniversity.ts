import { USER_AGENT } from "./http";
import { socialsFromWikidataClaims } from "./socials";
import { SocialLink } from "./types";

export interface Resolved {
  resolvedName: string;
  // English label when it differs from resolvedName - Commons/Openverse
  // captions are mostly English, so it doubles the image-search recall for
  // institutions whose native name is in another script.
  altName: string | null;
  city: string | null;
  country: string | null;
  officialWebsite: string | null;
  socials: SocialLink[];
  wikiSummary: string | null;
  wikiUrl: string | null;
  wikiTitle: string | null;
  wikiLang: string | null;
  studentCount: number | null;
  ambiguous: boolean;
  candidates: string[];
}

// Fallback only (used when the SPARQL classification is unreachable): a
// multilingual "this sounds like an educational institution" keyword test.
const EDU_KEYWORDS = new RegExp(
  [
    "universit", "universid", "università", "universität", "université", "üniversite",
    "college", "collège", "colegio", "kolej", "institut", "instituto", "istituto",
    "academy", "académie", "academia", "akademi", "polytechni", "politécnic", "politecnic",
    "conservator", "school of", "hochschule", "escuela", "escola", "école", "lyceum", "lycée",
    "seminar", "campus", "faculty", "sekolah", "uniwersytet", "univerzit", "egyetem",
    "университет", "институт", "колледж", "академия", "политехник", "консерватори", "лицей",
    "училище", "техникум", "университеті", "колледжі", "інститут", "університет",
    "大学", "學院", "学院", "大學", "学校", "대학", "학교", "大学校",
    "جامعة", "كلية", "معهد", "دانشگاه", "دانشکده",
    "विश्वविद्यालय", "महाविद्यालय", "มหาวิทยาลัย", "πανεπιστήμιο", "אוניברסיטת",
  ].join("|"),
  "i"
);

// Q2385804 = "educational institution", Q38723 = "higher education
// institution". Anything whose instance-of chain reaches the first is
// accepted (universities, colleges, vocational schools, academies,
// conservatories...); the second only ranks it above other schools.
const EDUCATIONAL_INSTITUTION = "Q2385804";
const HIGHER_EDUCATION = "Q38723";

type Script =
  | "cyrillic" | "han" | "kana" | "hangul" | "arabic" | "hebrew"
  | "devanagari" | "thai" | "greek" | "georgian" | "armenian" | "latin";

function detectScript(text: string): Script {
  if (/[぀-ヿ]/.test(text)) return "kana";
  if (/[一-鿿]/.test(text)) return "han";
  if (/[가-힯]/.test(text)) return "hangul";
  if (/[Ѐ-ӿ]/.test(text)) return "cyrillic";
  if (/[؀-ۿ]/.test(text)) return "arabic";
  if (/[֐-׿]/.test(text)) return "hebrew";
  if (/[ऀ-ॿ]/.test(text)) return "devanagari";
  if (/[฀-๿]/.test(text)) return "thai";
  if (/[Ͱ-Ͽ]/.test(text)) return "greek";
  if (/[Ⴀ-ჿ]/.test(text)) return "georgian";
  if (/[԰-֏]/.test(text)) return "armenian";
  return "latin";
}

// Wikidata's search only matches labels/aliases in the language you ask for,
// and a university's native name is usually labelled only in its own language
// ("Universidad Nacional Autónoma de México" has no English alias). So instead
// of assuming ru/en we search the query's script-appropriate languages in
// parallel, English first - that is what makes the pipeline work for "all
// universities and colleges of the world" rather than only ru/en queries.
const LANGS_BY_SCRIPT: Record<Script, string[]> = {
  latin: ["en", "es", "fr", "de", "pt", "it", "tr", "id"],
  cyrillic: ["ru", "en", "kk", "uk", "be", "bg", "sr"],
  han: ["zh", "ja", "en"],
  kana: ["ja", "en"],
  hangul: ["ko", "en"],
  arabic: ["ar", "fa", "ur", "en"],
  hebrew: ["he", "en"],
  devanagari: ["hi", "ne", "mr", "en"],
  thai: ["th", "en"],
  greek: ["el", "en"],
  georgian: ["ka", "en"],
  armenian: ["hy", "en"],
};

interface WikidataSearchHit {
  id: string;
  label: string;
  matchText: string;
  description?: string;
  lang: string;
  langRank: number;
  rank: number;
  exact: boolean;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function searchWikidataInLang(
  query: string,
  lang: string,
  langRank: number
): Promise<WikidataSearchHit[]> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        query
      )}&language=${lang}&uselang=${lang}&format=json&limit=10&origin=*`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const q = normalizeName(query);
    return (json.search ?? []).map(
      (
        r: {
          id: string;
          label?: string;
          description?: string;
          match?: { text?: string };
        },
        rank: number
      ): WikidataSearchHit => ({
        id: r.id,
        label: r.label ?? r.match?.text ?? r.id,
        matchText: r.match?.text ?? r.label ?? "",
        description: r.description,
        lang,
        langRank,
        rank,
        exact:
          normalizeName(r.label ?? "") === q ||
          normalizeName(r.match?.text ?? "") === q,
      })
    );
  } catch {
    return [];
  }
}

// One SPARQL round-trip classifies every candidate by its instance-of /
// subclass chain, so "Eton College", "Toraighyrov University" and a Chinese
// vocational school all count without relying on the wording of the label.
async function classifyEducational(
  ids: string[]
): Promise<Map<string, { higher: boolean }> | null> {
  if (ids.length === 0) return new Map();
  const sparql = `SELECT DISTINCT ?item ?he WHERE {
    VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
    ?item wdt:P31/wdt:P279* wd:${EDUCATIONAL_INSTITUTION} .
    BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:${HIGHER_EDUCATION} } AS ?he)
  }`;
  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
      {
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const out = new Map<string, { higher: boolean }>();
    for (const b of json.results?.bindings ?? []) {
      const id = String(b.item?.value ?? "").split("/").pop();
      if (!id) continue;
      const higher = b.he?.value === "true";
      out.set(id, { higher: out.get(id)?.higher || higher });
    }
    return out;
  } catch {
    return null;
  }
}

// Wikidata's search is prefix-based on labels *and* aliases in any language,
// so a query like "Almaty Polytechnic College" can surface an unrelated
// "Almaty University of Energy" that merely shares the first word. Unless the
// hit is an exact label/alias match, most of the query's distinctive words
// must appear in it (5-letter stems, so Russian/Kazakh endings don't matter).
function wordOverlap(query: string, text: string): number {
  const qWords = significantWords(query).map((w) => w.slice(0, 5));
  if (qWords.length === 0) return 1;
  const haystack = significantWords(text).map((w) => w.slice(0, 5));
  const found = qWords.filter((w) => haystack.includes(w)).length;
  return found / qWords.length;
}

// Same-name institutions exist ("Eton College" in Windsor vs Vancouver), so
// among the best candidates we prefer the one with more Wikipedia language
// editions - a cheap, language-independent proxy for "the well-known one".
async function sitelinkCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=sitelinks&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return out;
    const json = await res.json();
    for (const id of ids) {
      out.set(id, Object.keys(json.entities?.[id]?.sitelinks ?? {}).length);
    }
  } catch {
    // popularity is only a tie-breaker
  }
  return out;
}

async function searchWikidataEntity(
  query: string
): Promise<{ match: WikidataSearchHit; alternatives: string[] } | null> {
  const langs = LANGS_BY_SCRIPT[detectScript(query)];
  const perLang = await Promise.all(
    langs.map((lang, i) => searchWikidataInLang(query, lang, i))
  );

  // Dedupe across languages, keeping the best-ranked occurrence of each item.
  const byId = new Map<string, WikidataSearchHit>();
  for (const hit of perLang.flat()) {
    const prev = byId.get(hit.id);
    if (
      !prev ||
      (hit.exact && !prev.exact) ||
      (hit.exact === prev.exact && hit.rank < prev.rank)
    ) {
      byId.set(hit.id, hit);
    }
  }
  const hits = [...byId.values()].slice(0, 30);
  if (hits.length === 0) return null;

  const classified = await classifyEducational(hits.map((h) => h.id));

  const scored = hits
    .map((h) => {
      const keyword = EDU_KEYWORDS.test(h.description ?? "") || EDU_KEYWORDS.test(h.label);
      const cls = classified?.get(h.id);
      const overlapOk =
        h.exact || wordOverlap(query, `${h.label} ${h.matchText}`) >= 0.6;
      const isEdu = overlapOk && (classified ? Boolean(cls) : keyword);
      const score =
        (h.exact ? 8 : 0) +
        (cls?.higher ? 1.5 : 0) +
        (keyword ? 2 : 0) -
        h.langRank * 0.05 -
        h.rank * 0.3;
      return { hit: h, isEdu, score };
    })
    .filter((s) => s.isEdu)
    .sort((a, b) => b.score - a.score);

  // If SPARQL worked but rejected everything, still give keyword matches a
  // chance - some universities have no P31 chain to "educational institution".
  const pool =
    scored.length > 0
      ? scored
      : hits
          .filter(
            (h) =>
              (EDU_KEYWORDS.test(h.description ?? "") || EDU_KEYWORDS.test(h.label)) &&
              (h.exact || wordOverlap(query, `${h.label} ${h.matchText}`) >= 0.6)
          )
          .map((h) => ({ hit: h, isEdu: true, score: (h.exact ? 8 : 0) - h.rank * 0.3 }))
          .sort((a, b) => b.score - a.score);

  if (pool.length === 0) return null;

  const top = pool.slice(0, 8);
  const counts = await sitelinkCounts(top.map((s) => s.hit.id));
  for (const s of top) {
    s.score += Math.min(counts.get(s.hit.id) ?? 0, 150) / 25;
  }
  top.sort((a, b) => b.score - a.score);
  const ranked = [...top, ...pool.slice(8)];

  const match = ranked[0].hit;

  // Only other *education institutions* count as real ambiguity - a
  // same-name person or place isn't a competing interpretation worth
  // warning about.
  const alternatives = ranked
    .slice(1)
    .map((s) => s.hit.label)
    .filter((l) => l && l !== match.label)
    .slice(0, 4);

  return { match, alternatives };
}

interface WikidataClaim {
  mainsnak?: {
    datavalue?: { value?: { id?: string } | string };
  };
}

async function getWikidataLabel(qid: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.entities?.[qid]?.labels?.en?.value ?? null;
  } catch {
    return null;
  }
}

const NON_ARTICLE_WIKIS = new Set([
  "commonswiki", "wikidatawiki", "specieswiki", "metawiki", "mediawikiwiki",
  "wikimaniawiki", "outreachwiki", "sourceswiki",
]);

// Picks the best Wikipedia article: the language the user searched in, then
// English, then Russian, then any other language edition that has one.
function pickSitelink(
  sitelinks: Record<string, { title?: string }>,
  preferred: string
): { title: string; lang: string } | null {
  for (const lang of [preferred, "en", "ru"]) {
    const title = sitelinks[`${lang}wiki`]?.title;
    if (title) return { title, lang };
  }
  for (const [key, value] of Object.entries(sitelinks)) {
    if (!key.endsWith("wiki") || NON_ARTICLE_WIKIS.has(key) || !value?.title) continue;
    return { title: value.title, lang: key.slice(0, -4).replace(/_/g, "-") };
  }
  return null;
}

// P2196 (students count) usually has several dated values; take the newest
// (by point-in-time qualifier P585, else the last listed).
function latestQuantity(
  claims:
    | {
        mainsnak?: { datavalue?: { value?: { amount?: string } } };
        qualifiers?: { P585?: { datavalue?: { value?: { time?: string } } }[] };
      }[]
    | undefined
): number | null {
  if (!claims?.length) return null;
  let best: { amount: number; time: string } | null = null;
  for (const c of claims) {
    const amount = Number(c.mainsnak?.datavalue?.value?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const time = c.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? "";
    if (!best || time >= best.time) best = { amount, time };
  }
  return best ? Math.round(best.amount) : null;
}

interface WikidataEntityData {
  city: string | null;
  country: string | null;
  officialWebsite: string | null;
  socials: SocialLink[];
  englishName: string | null;
  // Label in the language the user searched in (falls back to null).
  primaryName: string | null;
  wikiTitle: string | null;
  wikiLang: string | null;
  studentCount: number | null;
}

const EMPTY_ENTITY: WikidataEntityData = {
  city: null,
  country: null,
  officialWebsite: null,
  socials: [],
  englishName: null,
  primaryName: null,
  wikiTitle: null,
  wikiLang: null,
  studentCount: null,
};

// Pulls city, country, official website, social accounts, English label and
// the best Wikipedia sitelink from a single wbgetentities call.
async function getWikidataEntity(
  wikibaseId: string,
  lang: string,
  primaryLang: string
): Promise<WikidataEntityData> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikibaseId}&props=claims|sitelinks|labels&languages=${[...new Set(["en", primaryLang])].join("|")}&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return EMPTY_ENTITY;
    const json = await res.json();
    const entity = json.entities?.[wikibaseId];
    const claims = entity?.claims ?? {};

    const qidOf = (claim?: WikidataClaim): string | undefined =>
      (claim?.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id;

    // P131 (located in admin. entity), else P159 (headquarters) / P276
    // (location) - smaller colleges often only have one of the latter.
    const cityQid = qidOf(claims.P131?.[0]) ?? qidOf(claims.P159?.[0]) ?? qidOf(claims.P276?.[0]);
    const countryQid = qidOf(claims.P17?.[0]) ?? qidOf(claims.P495?.[0]);

    const websiteClaim: WikidataClaim | undefined = claims.P856?.[0];
    const officialWebsite =
      typeof websiteClaim?.mainsnak?.datavalue?.value === "string"
        ? websiteClaim.mainsnak.datavalue.value
        : null;

    const wiki = pickSitelink(entity?.sitelinks ?? {}, lang);

    const [city, country] = await Promise.all([
      cityQid ? getWikidataLabel(cityQid) : Promise.resolve(null),
      countryQid ? getWikidataLabel(countryQid) : Promise.resolve(null),
    ]);

    return {
      city,
      country,
      officialWebsite,
      socials: socialsFromWikidataClaims(claims),
      englishName: entity?.labels?.en?.value ?? null,
      primaryName: entity?.labels?.[primaryLang]?.value ?? null,
      wikiTitle: wiki?.title ?? null,
      wikiLang: wiki?.lang ?? null,
      studentCount: latestQuantity(claims.P2196),
    };
  } catch {
    return EMPTY_ENTITY;
  }
}

async function getWikipediaSummary(
  title: string,
  lang: string = "en"
): Promise<{ extract: string | null; url: string | null }> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        title
      )}`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return { extract: null, url: null };
    const json = await res.json();
    return {
      extract: json.extract ?? null,
      url: json.content_urls?.desktop?.page ?? null,
    };
  } catch {
    return { extract: null, url: null };
  }
}

const GENERIC_TITLE_WORDS = new Set([
  "university", "college", "institute", "academy", "of", "the", "and",
  "state", "national", "university's", "school",
  "университет", "институт", "колледж", "академия", "государственный",
  "национальный", "имени",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !GENERIC_TITLE_WORDS.has(w));
}

// Secondary path: Wikipedia full-text search, used only when Wikidata has no
// matching entity at all. Requires the resolved title to share a real word
// with the query (not just "University") to avoid latching onto an
// unrelated page that happens to mention the query in passing.
export async function resolveViaWikipediaSearch(rawQuery: string): Promise<Resolved> {
  const lang = detectScript(rawQuery) === "cyrillic" ? "ru" : "en";
  const suffix = lang === "ru" ? "университет" : "university";
  const empty: Resolved = {
    resolvedName: rawQuery,
    altName: null,
    city: null,
    country: null,
    officialWebsite: null,
    socials: [],
    wikiSummary: null,
    wikiUrl: null,
    wikiTitle: null,
    wikiLang: null,
    studentCount: null,
    ambiguous: true,
    candidates: [],
  };

  try {
    const searchRes = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        rawQuery + " " + suffix
      )}&format=json&srlimit=5&origin=*`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    const searchJson = await searchRes.json();
    const rawHits: { title: string }[] = searchJson?.query?.search ?? [];

    const queryWords = significantWords(rawQuery);
    const hits = rawHits.filter((h) => {
      if (/^list of\b|\(disambiguation\)$|^список\b|\(значения\)$/i.test(h.title))
        return false;
      if (queryWords.length === 0) return true;
      return wordOverlap(rawQuery, h.title) >= 0.6;
    });

    if (hits.length === 0) return empty;

    const topTitle = hits[0].title;
    const candidates = hits.map((h) => h.title);
    const { extract, url } = await getWikipediaSummary(topTitle, lang);

    return {
      ...empty,
      resolvedName: topTitle,
      wikiSummary: extract,
      wikiUrl: url,
      wikiTitle: topTitle,
      wikiLang: lang,
      ambiguous: candidates.length > 1,
      candidates,
    };
  } catch {
    return empty;
  }
}

// Resolves a (possibly ambiguous, possibly obscure, any-language) university
// or college name to a canonical identity: Wikidata first (broadest global
// coverage - most institutions have at least a stub entity even with no
// Wikipedia article), falling back to Wikipedia full-text search only if
// Wikidata has nothing.
export async function resolveViaWikidata(rawQuery: string): Promise<Resolved | null> {
  const wd = await searchWikidataEntity(rawQuery);
  if (!wd) return null;

  const { match, alternatives } = wd;
  const primaryLang = LANGS_BY_SCRIPT[detectScript(rawQuery)][0];
  const entity = await getWikidataEntity(match.id, match.lang, primaryLang);

  const { extract, url } =
    entity.wikiTitle && entity.wikiLang
      ? await getWikipediaSummary(entity.wikiTitle, entity.wikiLang)
      : { extract: null, url: null };

  // Show the name in the language the user typed (so a Spanish speaker asking
  // for "Universidad de Chile" isn't shown an Indonesian alias), and keep the
  // English label as a second image-search term.
  const resolvedName = entity.primaryName ?? entity.englishName ?? match.label;
  const altName =
    entity.englishName && entity.englishName !== resolvedName
      ? entity.englishName
      : null;

  return {
    resolvedName,
    altName,
    city: entity.city,
    country: entity.country,
    officialWebsite: entity.officialWebsite,
    socials: entity.socials,
    wikiSummary: extract ?? match.description ?? null,
    wikiUrl: url,
    wikiTitle: entity.wikiTitle,
    wikiLang: entity.wikiLang,
    studentCount: entity.studentCount,
    ambiguous: alternatives.length > 0,
    candidates: [match.label, ...alternatives],
  };
}
