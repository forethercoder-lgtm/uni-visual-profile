import { USER_AGENT } from "./http";
import { Category, ImageCandidate, SocialLink } from "./types";
import { extractSocialsFromHtml } from "./socials";

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
interface Homepage {
  html: string;
  finalUrl: string;
}

// The photo search, the meta-description summary and the social-link scan all
// need the same homepage - fetch it once per request burst, not three times.
const homepageCache = new Map<
  string,
  { at: number; promise: Promise<Homepage | null> }
>();
const HOMEPAGE_TTL_MS = 60_000;

function fetchHomepage(websiteUrl: string): Promise<Homepage | null> {
  const hit = homepageCache.get(websiteUrl);
  if (hit && Date.now() - hit.at < HOMEPAGE_TTL_MS) return hit.promise;

  const promise = (async (): Promise<Homepage | null> => {
    try {
      const res = await fetch(websiteUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(7000),
        redirect: "follow",
      });
      if (!res.ok) return null;
      if (!(res.headers.get("content-type") || "").includes("html")) return null;
      return { html: await res.text(), finalUrl: res.url };
    } catch {
      return null;
    }
  })();
  homepageCache.set(websiteUrl, { at: Date.now(), promise });
  return promise;
}

export async function fetchOfficialSiteSocials(
  websiteUrl: string
): Promise<SocialLink[]> {
  const page = await fetchHomepage(websiteUrl);
  return page ? extractSocialsFromHtml(page.html) : [];
}

export async function searchOfficialSite(
  websiteUrl: string,
  category: Category = "campus"
): Promise<ImageCandidate[]> {
  try {
    const page = await fetchHomepage(websiteUrl);
    if (!page) return [];
    const html = page.html;
    const base = new URL(page.finalUrl);

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
    const page = await fetchHomepage(websiteUrl);
    if (!page) return null;
    const html = page.html;
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

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

const FACULTY_LINK_RE =
  /faculty|faculties|schools?\b|department|academics|programs?\b|colleges?\b|факультет|кафедр|школ[аы]|программ|институт|fakült|fakultät|facultad|faculté/i;
const STUDENT_LINK_RE =
  /student|campus|clubs?\b|activit|societ|organi[sz]ation|life|extracurricular|студент|клуб|внеучеб|жизнь|кампус|студен/i;
const SKIP_HREF_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|svg|mp4)(\?|$)|^(mailto|tel|javascript):|^#/i;
const ANCHOR_RE = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

export interface SitePage {
  url: string;
  text: string;
}

// Reads a few sub-pages of the university's own site that are most likely to
// describe faculties/schools and student life (found by link text/path on the
// homepage), so structured facts come from the institution itself instead of
// the model's memory. Same-host links only; small text budget per page.
export async function fetchOfficialSitePages(
  websiteUrl: string,
  perKind = 2
): Promise<SitePage[]> {
  const page = await fetchHomepage(websiteUrl);
  if (!page) return [];

  const base = new URL(page.finalUrl);
  const host = base.hostname.replace(/^www\./, "");
  const faculty: string[] = [];
  const student: string[] = [];
  const seen = new Set<string>([base.toString()]);

  for (const m of page.html.matchAll(ANCHOR_RE)) {
    const href = m[1].trim();
    if (SKIP_HREF_RE.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.hostname.replace(/^www\./, "") !== host) continue;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) continue;

    const label = htmlToText(m[2]).slice(0, 80);
    const probe = `${label} ${abs.pathname}`;
    if (FACULTY_LINK_RE.test(probe) && faculty.length < perKind) {
      faculty.push(key);
      seen.add(key);
    } else if (STUDENT_LINK_RE.test(probe) && student.length < perKind) {
      student.push(key);
      seen.add(key);
    }
    if (faculty.length >= perKind && student.length >= perKind) break;
  }

  const fetched = await Promise.all(
    [...faculty, ...student].map(async (url): Promise<SitePage | null> => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(5000),
          redirect: "follow",
        });
        if (!res.ok) return null;
        if (!(res.headers.get("content-type") || "").includes("html")) return null;
        const text = htmlToText(await res.text()).slice(0, 3500);
        return text.length > 200 ? { url, text } : null;
      } catch {
        return null;
      }
    })
  );
  return fetched.filter((p): p is SitePage => p !== null);
}
