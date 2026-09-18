import { USER_AGENT } from "./http";
import { Category, ImageCandidate } from "./types";

const SKIP_FILENAME_RE = /(logo|icon|favicon|sprite|pixel|spacer|placeholder|avatar)/i;
const MAX_IMAGES = 15;

function isLikelyContentImage(url: string, width?: number, height?: number): boolean {
  if (url.startsWith("data:")) return false;
  if (/\.svg(\?|$)/i.test(url)) return false;
  if (SKIP_FILENAME_RE.test(url)) return false;
  if (width && height && (width < 150 || height < 100)) return false;
  return true;
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_RE = /\bsrc=["']([^"']+)["']/i;
const WIDTH_RE = /\bwidth=["']?(\d+)/i;
const HEIGHT_RE = /\bheight=["']?(\d+)/i;
const ALT_RE = /\balt=["']([^"']*)["']/i;

// Most universities have a website even when they have no Commons/Openverse
// presence — this is the fallback that lets the pipeline scale toward the
// long tail of ~25,000 institutions worldwide instead of only the ones
// popular enough to have crowd-sourced photos elsewhere. It only looks at
// the homepage (arbitrary site structures make deeper crawling unreliable
// within the time budget), and Gemini verification still has the final say
// on whether an extracted image is actually a relevant campus photo.
export async function searchOfficialSite(
  websiteUrl: string,
  category: Category = "campus"
): Promise<ImageCandidate[]> {
  try {
    const res = await fetch(websiteUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(7000),
      redirect: "follow",
    });
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html")) return [];

    const html = await res.text();
    const base = new URL(res.url);

    const seen = new Set<string>();
    const candidates: ImageCandidate[] = [];

    for (const match of html.matchAll(IMG_TAG_RE)) {
      if (candidates.length >= MAX_IMAGES) break;
      const tag = match[0];
      const srcMatch = tag.match(SRC_RE);
      if (!srcMatch) continue;

      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(srcMatch[1], base).toString();
      } catch {
        continue;
      }
      if (seen.has(absoluteUrl)) continue;

      const width = Number(tag.match(WIDTH_RE)?.[1]) || undefined;
      const height = Number(tag.match(HEIGHT_RE)?.[1]) || undefined;
      if (!isLikelyContentImage(absoluteUrl, width, height)) continue;

      seen.add(absoluteUrl);
      candidates.push({
        url: absoluteUrl,
        sourcePage: base.toString(),
        title: tag.match(ALT_RE)?.[1] || "Фото с официального сайта университета",
        category,
        width,
        height,
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

const META_DESC_RE = [
  /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
  /<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i,
  /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i,
  /<meta\s+content=["']([^"']*)["']\s+property=["']og:description["']/i,
];

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => HTML_ENTITIES[name]);
}

// Wikipedia doesn't have an article for most of the ~25,000 universities
// worldwide, but almost every one has a homepage with a meta description —
// a second, independent factual source for the campus summary instead of
// relying on Wikipedia alone.
export async function fetchOfficialSiteSummary(
  websiteUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(websiteUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html")) return null;

    const html = await res.text();
    for (const re of META_DESC_RE) {
      const match = html.match(re)?.[1];
      if (match && match.trim().length > 20) {
        return decodeHtmlEntities(match.trim()).slice(0, 600);
      }
    }
    return null;
  } catch {
    return null;
  }
}
