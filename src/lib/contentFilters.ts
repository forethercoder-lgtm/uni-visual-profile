import { ImageCandidate } from "./types";

// Stock-photo marketplaces should never appear in results — the case
// explicitly forbids passing off stock photography as real campus photos.
// Commons/Openverse/official sites shouldn't surface these, but a domain
// blocklist is a cheap, deterministic safety net independent of what the
// AI verification step happens to judge as "relevant".
const STOCK_DOMAIN_RE =
  /shutterstock|gettyimages|istockphoto|depositphotos|alamy\.com|dreamstime|123rf\.com|adobestock|bigstockphoto|canstockphoto/i;

export function isStockPhoto(candidate: ImageCandidate): boolean {
  return STOCK_DOMAIN_RE.test(candidate.url) || STOCK_DOMAIN_RE.test(candidate.sourcePage);
}

// Keyword-based filter for historical/archival ephemera (statues, portraits,
// monuments, vintage/sepia scans, heraldry, medals, maps) that would show a
// visitor the wrong thing for "what the campus looks like today" — without
// rejecting genuinely old-but-still-standing campus buildings just because
// a photo's caption happens to be old.
const HISTORICAL_RE = new RegExp(
  [
    "statue", "monument", "bust\\b", "sculpture", "memorial", "plaque",
    "tomb", "grave", "cemetery", "crypt",
    "portrait", "founder", "chancellor",
    "painting", "oil on canvas", "fresco", "engraving", "lithograph", "woodcut",
    "black and white", "black-and-white", "monochrome", "sepia", "daguerreotype",
    "vintage", "antique", "archival",
    "coat of arms", "heraldry", "crest", "postage stamp", "banknote", "coin\\b", "medal",
    "памятник", "монумент", "бюст", "статуя", "скульптура", "мемориал",
    "портрет", "основатель",
    "картина", "гравюра", "литография",
    "черно-бел", "старинн", "архивн",
    "герб", "марка почтов", "банкнота", "монета",
  ].join("|"),
  "i"
);

export function isHistoricalContent(candidate: ImageCandidate): boolean {
  return HISTORICAL_RE.test(candidate.title);
}

export function filterContentCandidates<T extends ImageCandidate>(
  candidates: T[]
): T[] {
  return candidates.filter((c) => !isStockPhoto(c) && !isHistoricalContent(c));
}
