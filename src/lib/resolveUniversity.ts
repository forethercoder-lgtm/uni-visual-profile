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

// Single wbgetclaims call (no property filter) pulls city (P131), country
// (P17) and official website (P856) together instead of three round trips.
async function getWikidataFacts(wikibaseId: string): Promise<{
  city: string | null;
  country: string | null;
  officialWebsite: string | null;
}> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikibaseId}&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) return { city: null, country: null, officialWebsite: null };
    const json = await res.json();
    const claims = json.claims ?? {};

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

    const [city, country] = await Promise.all([
      cityQid ? getWikidataLabel(cityQid) : Promise.resolve(null),
      countryQid ? getWikidataLabel(countryQid) : Promise.resolve(null),
    ]);

    return { city, country, officialWebsite };
  } catch {
    return { city: null, country: null, officialWebsite: null };
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

// Disambiguates the university name via Wikipedia search, then pulls a short
// factual summary plus city/country/official-website from the linked
// Wikidata entity — city is required both for "photos of the city" and for
// scoping image search queries; the official website is the fallback image
// source for universities with no Commons/Openverse presence.
export async function resolveUniversity(rawQuery: string): Promise<Resolved> {
  const searchRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      rawQuery + " university"
    )}&format=json&srlimit=5&origin=*`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  const searchJson = await searchRes.json();
  const rawHits: { title: string }[] = searchJson?.query?.search ?? [];

  // Full-text search surfaces "List of..."/overview articles, and pages
  // about an entirely different institution that merely also contains the
  // word "University" — trusting the top hit blindly can resolve to a
  // wrong or unrelated page, which is worse than admitting we found
  // nothing. Require the title to share a real (non-generic) word with the
  // query, e.g. "Toraighyrov" — not just "University".
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

  const summaryRes = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      topTitle
    )}`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  if (!summaryRes.ok) {
    return {
      resolvedName: topTitle,
      city: null,
      country: null,
      officialWebsite: null,
      wikiSummary: null,
      wikiUrl: null,
      ambiguous: candidates.length > 1,
      candidates,
    };
  }
  const summaryJson = await summaryRes.json();
  const wikibaseId: string | undefined = summaryJson.wikibase_item;

  const { city, country, officialWebsite } = wikibaseId
    ? await getWikidataFacts(wikibaseId)
    : { city: null, country: null, officialWebsite: null };

  return {
    resolvedName: summaryJson.title ?? topTitle,
    city,
    country,
    officialWebsite,
    wikiSummary: summaryJson.extract ?? null,
    wikiUrl: summaryJson.content_urls?.desktop?.page ?? null,
    ambiguous: candidates.length > 1,
    candidates,
  };
}
