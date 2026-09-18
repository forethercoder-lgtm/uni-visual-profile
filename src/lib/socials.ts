import { SocialLink, SocialPlatform } from "./types";

// Instagram/Facebook/TikTok serve a login wall to anonymous crawlers, so we
// can't read their posts or photos without the platform's own API + auth.
// What we *can* do honestly is discover the institution's official accounts
// (linked from its own site, or curated in Wikidata) and hand the user the
// links — Instagram first, since that's where campus life is actually shown.
export const SOCIAL_ORDER: SocialPlatform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "telegram",
  "vk",
  "x",
  "linkedin",
];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  telegram: "Telegram",
  vk: "ВКонтакте",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
};

const SHARE_SEGMENTS = new Set([
  "share", "sharer", "sharer.php", "intent", "dialog", "plugins", "tr",
  "p", "reel", "reels", "explore", "accounts", "home", "login", "watch",
  "hashtag", "embed", "share.php", "widgets", "policies", "about",
]);

function segments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

export function classifySocialUrl(
  raw: string,
  source: SocialLink["source"]
): SocialLink | null {
  let url: URL;
  try {
    url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const [first, second] = segments(url);
  const make = (
    platform: SocialPlatform,
    handle: string,
    canonical: string
  ): SocialLink => ({ platform, url: canonical, handle, summary: null, source });

  if (host === "instagram.com") {
    if (!first || SHARE_SEGMENTS.has(first.toLowerCase())) return null;
    return make("instagram", `@${first}`, `https://www.instagram.com/${first}/`);
  }
  if (host === "facebook.com" || host === "fb.com") {
    if (!first || SHARE_SEGMENTS.has(first.toLowerCase())) return null;
    return make("facebook", first, `https://www.facebook.com/${first}`);
  }
  if (host === "tiktok.com") {
    if (!first?.startsWith("@")) return null;
    return make("tiktok", first, `https://www.tiktok.com/${first}`);
  }
  if (host === "youtube.com") {
    if (!first) return null;
    if (first.startsWith("@"))
      return make("youtube", first, `https://www.youtube.com/${first}`);
    if (["channel", "c", "user"].includes(first) && second)
      return make("youtube", second, `https://www.youtube.com/${first}/${second}`);
    return null;
  }
  if (host === "x.com" || host === "twitter.com") {
    if (!first || SHARE_SEGMENTS.has(first.toLowerCase())) return null;
    return make("x", `@${first}`, `https://x.com/${first}`);
  }
  if (host === "t.me" || host === "telegram.me") {
    if (!first || SHARE_SEGMENTS.has(first.toLowerCase()) || first === "joinchat")
      return null;
    return make("telegram", `@${first}`, `https://t.me/${first}`);
  }
  if (host === "vk.com" || host === "vk.ru") {
    if (!first || SHARE_SEGMENTS.has(first.toLowerCase())) return null;
    return make("vk", first, `https://vk.com/${first}`);
  }
  if (host === "linkedin.com") {
    if ((first === "school" || first === "company") && second)
      return make("linkedin", second, `https://www.linkedin.com/${first}/${second}/`);
    return null;
  }
  return null;
}

const HREF_RE = /\bhref=["']([^"']+)["']/gi;

export function extractSocialsFromHtml(html: string): SocialLink[] {
  const found: SocialLink[] = [];
  for (const match of html.matchAll(HREF_RE)) {
    const link = classifySocialUrl(match[1].replace(/&amp;/g, "&"), "official_site");
    if (link) found.push(link);
  }
  return found;
}

// Wikidata properties holding an account identifier (not a full URL).
const WIKIDATA_SOCIAL_PROPS: {
  prop: string;
  build: (value: string) => string;
}[] = [
  { prop: "P2003", build: (v) => `https://www.instagram.com/${v}/` },
  { prop: "P7085", build: (v) => `https://www.tiktok.com/@${v.replace(/^@/, "")}` },
  { prop: "P2397", build: (v) => `https://www.youtube.com/channel/${v}` },
  { prop: "P2013", build: (v) => `https://www.facebook.com/${v}` },
  { prop: "P3789", build: (v) => `https://t.me/${v}` },
  { prop: "P3185", build: (v) => `https://vk.com/${v}` },
  { prop: "P2002", build: (v) => `https://x.com/${v}` },
  { prop: "P4264", build: (v) => `https://www.linkedin.com/company/${v}/` },
];

export function socialsFromWikidataClaims(
  claims: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>
): SocialLink[] {
  const found: SocialLink[] = [];
  for (const { prop, build } of WIKIDATA_SOCIAL_PROPS) {
    const value = claims[prop]?.[0]?.mainsnak?.datavalue?.value;
    if (typeof value !== "string" || !value) continue;
    const link = classifySocialUrl(build(value), "wikidata");
    if (link) found.push(link);
  }
  return found;
}

// One account per platform. The institution's own site wins over Wikidata
// (it's what the university itself currently links to); Wikidata fills gaps.
export function mergeSocials(...lists: SocialLink[][]): SocialLink[] {
  const byPlatform = new Map<SocialPlatform, SocialLink>();
  for (const list of lists) {
    for (const link of list) {
      if (!byPlatform.has(link.platform)) byPlatform.set(link.platform, link);
    }
  }
  return SOCIAL_ORDER.flatMap((p) => byPlatform.get(p) ?? []);
}
