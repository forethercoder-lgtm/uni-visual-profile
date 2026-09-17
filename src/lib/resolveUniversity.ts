import { USER_AGENT } from "./http";

interface Resolved {
  resolvedName: string;
  city: string | null;
  country: string | null;
  wikiSummary: string | null;
  wikiUrl: string | null;
  ambiguous: boolean;
  candidates: string[];
}

interface WikidataClaim {
  mainsnak?: {
    datavalue?: { value?: { id?: string } };
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

async function getLocationFromWikidata(
  wikibaseId: string
): Promise<{ city: string | null; country: string | null }> {
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikibaseId}&property=P131&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    const countryRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikibaseId}&property=P17&format=json&origin=*`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    const json = res.ok ? await res.json() : null;
    const countryJson = countryRes.ok ? await countryRes.json() : null;

    const cityClaim: WikidataClaim | undefined = json?.claims?.P131?.[0];
    const countryClaim: WikidataClaim | undefined =
      countryJson?.claims?.P17?.[0];

    const cityQid = cityClaim?.mainsnak?.datavalue?.value?.id;
    const countryQid = countryClaim?.mainsnak?.datavalue?.value?.id;

    const [city, country] = await Promise.all([
      cityQid ? getWikidataLabel(cityQid) : Promise.resolve(null),
      countryQid ? getWikidataLabel(countryQid) : Promise.resolve(null),
    ]);

    return { city, country };
  } catch {
    return { city: null, country: null };
  }
}

// Disambiguates the university name via Wikipedia search, then pulls a short
// factual summary plus city/country from the linked Wikidata entity — city
// is required both for "photos of the city" and for scoping image search
// queries to the right place.
export async function resolveUniversity(rawQuery: string): Promise<Resolved> {
  const searchRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      rawQuery + " university"
    )}&format=json&srlimit=5&origin=*`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  const searchJson = await searchRes.json();
  const hits: { title: string }[] = searchJson?.query?.search ?? [];

  if (hits.length === 0) {
    return {
      resolvedName: rawQuery,
      city: null,
      country: null,
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
      wikiSummary: null,
      wikiUrl: null,
      ambiguous: candidates.length > 1,
      candidates,
    };
  }
  const summaryJson = await summaryRes.json();
  const wikibaseId: string | undefined = summaryJson.wikibase_item;

  const { city, country } = wikibaseId
    ? await getLocationFromWikidata(wikibaseId)
    : { city: null, country: null };

  return {
    resolvedName: summaryJson.title ?? topTitle,
    city,
    country,
    wikiSummary: summaryJson.extract ?? null,
    wikiUrl: summaryJson.content_urls?.desktop?.page ?? null,
    ambiguous: candidates.length > 1,
    candidates,
  };
}
