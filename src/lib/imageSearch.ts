import { USER_AGENT } from "./http";
import { searchOfficialSite } from "./officialSite";
import { CATEGORY_QUERIES, Category, ImageCandidate } from "./types";

const RESULTS_PER_SOURCE = 10;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|tiff?)$/i;

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  descriptionurl: string;
  timestamp?: string;
  extmetadata?: {
    DateTimeOriginal?: { value: string };
  };
}

interface CommonsPage {
  title: string;
  imageinfo?: CommonsImageInfo[];
}

// Wikimedia Commons: free, no API key, and images already carry a source
// page + date — exactly what the case asks for instead of untraceable stock
// photos. Full-text search is effectively AND-of-terms, so we keep queries
// short: a broad "university [+city]" pool tagged with a weak category hint,
// the real per-photo category is decided later by Gemini from the image itself.
async function searchCommons(
  searchTerms: string,
  categoryHint: Category,
  limit = RESULTS_PER_SOURCE
): Promise<ImageCandidate[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", searchTerms);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", String(limit));
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata|timestamp");
  url.searchParams.set("iiurlwidth", "500");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const pages: Record<string, CommonsPage> = json.query?.pages ?? {};

  return Object.values(pages)
    .map((page): ImageCandidate | null => {
      const info = page.imageinfo?.[0];
      const title = page.title.replace(/^File:/, "");
      if (!info || !IMAGE_EXT_RE.test(title)) return null;
      return {
        url: info.url,
        thumbnailUrl: info.thumburl,
        sourcePage: info.descriptionurl,
        title,
        category: categoryHint,
        contextDate:
          info.extmetadata?.DateTimeOriginal?.value ?? info.timestamp,
      };
    })
    .filter((c): c is ImageCandidate => c !== null);
}

interface OpenverseResult {
  url: string;
  thumbnail?: string;
  foreign_landing_url: string;
  title?: string;
}

// Openverse: free, no key required, aggregates CC-licensed photos (Flickr
// Commons, museums, etc.) with attribution links — good coverage complement
// for categories Commons is thin on (student life, sports).
async function searchOpenverse(
  query: string,
  categoryHint: Category,
  limit = RESULTS_PER_SOURCE
): Promise<ImageCandidate[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", String(limit));

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const results: OpenverseResult[] = json.results ?? [];

  return results.map((r) => ({
    url: r.url,
    thumbnailUrl: r.thumbnail,
    sourcePage: r.foreign_landing_url,
    title: r.title || "Untitled",
    category: categoryHint,
  }));
}

const NON_CITY_CATEGORIES: Category[] = [
  "campus",
  "dorms",
  "classrooms",
  "library",
  "sports",
  "labs",
  "student_life",
];

export async function searchAllCategories(
  universityName: string,
  city: string | null,
  officialWebsite: string | null,
  altName: string | null = null
): Promise<ImageCandidate[]> {
  const tasks: Promise<ImageCandidate[]>[] = [];

  // Broad base pool — just the institution name, biggest single source of hits.
  tasks.push(searchCommons(`"${universityName}"`, "campus", 20));
  tasks.push(searchOpenverse(universityName, "campus", 15));
  // Same institution under its other-language name (e.g. English label of a
  // native-script name) - Commons/Openverse captions are mostly English.
  if (altName) {
    tasks.push(searchCommons(`"${altName}"`, "campus", 20));
    tasks.push(searchOpenverse(altName, "campus", 15));
  }

  // The official website is the fallback that scales to universities with
  // no Commons/Openverse presence — most of the ~25,000 worldwide have a
  // site even when nobody has ever uploaded a CC-licensed photo of them.
  if (officialWebsite) {
    tasks.push(searchOfficialSite(officialWebsite, "campus"));
  }

  // Per-category supplemental searches (best-effort; many will return few/none).
  for (const category of NON_CITY_CATEGORIES) {
    const hint = CATEGORY_QUERIES[category];
    if (!hint) continue;
    tasks.push(
      searchCommons(`"${universityName}" (${hint})`, category),
      searchOpenverse(`${universityName} ${hint.replace(/ OR /g, " ")}`, category)
    );
  }

  // City photos are about the city itself, not the university.
  if (city) {
    tasks.push(searchCommons(`"${city}" cityscape OR skyline OR downtown`, "city", 12));
    tasks.push(searchOpenverse(`${city} city`, "city", 12));
  }

  const settled = await Promise.allSettled(tasks);
  const candidates: ImageCandidate[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") candidates.push(...r.value);
  }
  return candidates;
}
