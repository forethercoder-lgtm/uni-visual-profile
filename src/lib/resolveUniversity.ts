import { USER_AGENT } from "./http";

interface Resolved {
  resolvedName: string;
  city: string | null;
  country: string | null;
  officialWebsite: string | null;
  wikiSummary: string | null;
  wikiUrl: string | null;
  ambiguous: boolean;
  candidates: string[];
}

const EDU_KEYWORDS =
  /university|college|institute|academy|polytechnic|conservatory|school of/i;

interface WikidataSearchHit {
  id: string;
  label: string;
  description?: string;
}

// Wikidata indexes far more of the world's ~25,000 universities than
// English Wikipedia has prose articles for (most have at least a stub
// Wikidata item with a label/description even with zero sitelinks) — this
// is the primary resolution path so the pipeline scales past the famous
// handful. Its own search ranks by label match, so a false-positive like
// "Moscow City University" beating "Toraighyrov University" is far less
// likely than with Wikipedia's mention-frequency full-text search.
async function searchWikidataEntity(
  query: string
): Promise<{ match: WikidataSearchHit; alternatives: string[] } | null> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        query
      )}&language=en&format=json&limit=6&origin=*`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const hits: WikidataSearchHit[] = (json.search ?? []).map(
      (r: { id: string; label: string; description?: string }) => ({
        id: r.id,
        label: r.label,
        description: r.description,
      })
    );

    const eduHits = hits.filter(
      (h) => EDU_KEYWORDS.test(h.description ?? "") || EDU_KEYWORDS.test(h.label)
    );
    const match = eduHits[0];
    if (!match) return null;

    // Only other *education institutions* count as real ambiguity — a
    // same-name person or place in the raw hit list isn't a competing
    // interpretation worth warning about.
    const alternatives = eduHits.slice(1).map((h) => h.label).filter(Boolean);

    return { match, alternatives };
  } catch {
    return null;
  }
}

interface WikidataClaim {
  mainsnak?: {
    datavalue?: { value?: { id?: string } | string };
  };
}

async function getWikidataLabel(qid: string): Promise<string | null> {
  const res = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json&origin=*`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.entities?.[qid]?.labels?.en?.value ?? null;
}

// Pulls city (P131), country (P17), official website (P856) and the English
// Wikipedia sitelink (if any — most of the long tail won't have one) from a
// single wbgetentities call.
async function getWikidataEntity(wikibaseId: string): Promise<{
  city: string | null;
  country: string | null;
  officialWebsite: string | null;
  enwikiTitle: string | null;
}> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikibaseId}&props=claims|sitelinks&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) {
      return { city: null, country: null, officialWebsite: null, enwikiTitle: null };
    }
    const json = await res.json();
    const entity = json.entities?.[wikibaseId];
    const claims = entity?.claims ?? {};

    const cityClaim: WikidataClaim | undefined = claims.P131?.[0];
    const countryClaim: WikidataClaim | undefined = claims.P17?.[0];
    const websiteClaim: WikidataClaim | undefined = claims.P856?.[0];

    const cityQid = (cityClaim?.mainsnak?.datavalue?.value as { id?: string })
      ?.id;
    const countryQid = (
      countryClaim?.mainsnak?.datavalue?.value as { id?: string }
    )?.id;
    const officialWebsite =
      typeof websiteClaim?.mainsnak?.datavalue?.value === "string"
        ? websiteClaim.mainsnak.datavalue.value
        : null;
    const enwikiTitle: string | null = entity?.sitelinks?.enwiki?.title ?? null;

    const [city, country] = await Promise.all([
      cityQid ? getWikidataLabel(cityQid) : Promise.resolve(null),
      countryQid ? getWikidataLabel(countryQid) : Promise.resolve(null),
    ]);

    return { city, country, officialWebsite, enwikiTitle };
  } catch {
    return { city: null, country: null, officialWebsite: null, enwikiTitle: null };
  }
}

async function getWikipediaSummary(
  title: string
): Promise<{ extract: string | null; url: string | null }> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
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
  "state", "national", "university's",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((w) => w.length > 2 && !GENERIC_TITLE_WORDS.has(w));
}

// Secondary path: Wikipedia full-text search, used only when Wikidata has no
// matching entity at all. Requires the resolved title to share a real word
// with the query (not just "University") to avoid latching onto an
// unrelated page that happens to mention the query in passing.
async function resolveViaWikipediaSearch(rawQuery: string): Promise<Resolved> {
  const searchRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      rawQuery + " university"
    )}&format=json&srlimit=5&origin=*`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  const searchJson = await searchRes.json();
  const rawHits: { title: string }[] = searchJson?.query?.search ?? [];

  const queryWords = significantWords(rawQuery);
  const hits = rawHits.filter((h) => {
    if (/^list of\b|\(disambiguation\)$/i.test(h.title)) return false;
    if (queryWords.length === 0) return true;
    const titleLower = h.title.toLowerCase();
    return queryWords.some((w) => titleLower.includes(w));
  });

  if (hits.length === 0) {
    return {
      resolvedName: rawQuery,
      city: null,
      country: null,
      officialWebsite: null,
      wikiSummary: null,
      wikiUrl: null,
      ambiguous: true,
      candidates: [],
    };
  }

  const topTitle = hits[0].title;
  const candidates = hits.map((h) => h.title);
  const { extract, url } = await getWikipediaSummary(topTitle);

  return {
    resolvedName: topTitle,
    city: null,
    country: null,
    officialWebsite: null,
    wikiSummary: extract,
    wikiUrl: url,
    ambiguous: candidates.length > 1,
    candidates,
  };
}

// Resolves a (possibly ambiguous, possibly obscure) university name to a
// canonical identity: Wikidata first (broadest global coverage — most
// universities have at least a stub entity even with no Wikipedia article),
// falling back to Wikipedia full-text search only if Wikidata has nothing.
export async function resolveUniversity(rawQuery: string): Promise<Resolved> {
  const wd = await searchWikidataEntity(rawQuery);
  if (!wd) {
    return resolveViaWikipediaSearch(rawQuery);
  }

  const { match, alternatives } = wd;
  const { city, country, officialWebsite, enwikiTitle } = await getWikidataEntity(
    match.id
  );

  const { extract, url } = enwikiTitle
    ? await getWikipediaSummary(enwikiTitle)
    : { extract: null, url: null };

  return {
    resolvedName: match.label,
    city,
    country,
    officialWebsite,
    wikiSummary: extract ?? match.description ?? null,
    wikiUrl: url,
    ambiguous: alternatives.length > 0,
    candidates: [match.label, ...alternatives],
  };
}
