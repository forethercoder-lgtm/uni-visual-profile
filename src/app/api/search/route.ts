import { NextRequest, NextResponse } from "next/server";
import { resolveUniversity } from "@/lib/resolveUniversity";
import { searchAllCategories } from "@/lib/imageSearch";
import { dedupeCandidates } from "@/lib/dedup";
import { verifyBatch, generateDescription } from "@/lib/gemini";
import { fetchOfficialSiteSummary, fetchOfficialSiteSocials } from "@/lib/officialSite";
import { mergeSocials } from "@/lib/socials";
import { filterContentCandidates } from "@/lib/contentFilters";
import { getCached, setCached } from "@/lib/cache";
import { Category, ImageCandidate, UniversityProfile, VerifiedImage } from "@/lib/types";

const ALL_CATEGORIES: Category[] = [
  "campus",
  "dorms",
  "classrooms",
  "library",
  "city",
  "sports",
  "labs",
  "student_life",
];

const MIN_CONFIDENCE_TO_SHOW = 0.35;
const LOW_CONFIDENCE_WARNING = 0.6;
// Caps total Gemini verification calls so search time stays bounded
// regardless of how many raw candidates the search step turns up.
const MAX_CANDIDATES_TO_VERIFY = 36;

// Round-robins across category-hint buckets so the cap doesn't starve
// less common categories in favor of whichever bucket returned the most hits.
function capWithDiversity(
  candidates: ImageCandidate[],
  max: number
): ImageCandidate[] {
  if (candidates.length <= max) return candidates;

  const buckets = new Map<Category, ImageCandidate[]>();
  for (const c of candidates) {
    if (!buckets.has(c.category)) buckets.set(c.category, []);
    buckets.get(c.category)!.push(c);
  }
  const bucketArrays = [...buckets.values()];

  const picked: ImageCandidate[] = [];
  let round = 0;
  while (picked.length < max) {
    let addedAny = false;
    for (const bucket of bucketArrays) {
      if (round < bucket.length) {
        picked.push(bucket[round]);
        addedAny = true;
        if (picked.length >= max) break;
      }
    }
    if (!addedAny) break;
    round++;
  }
  return picked;
}

export async function GET(req: NextRequest) {
  const start = Date.now();
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ error: "Параметр q обязателен" }, { status: 400 });
  }

  const cached = getCached(q);
  if (cached) {
    return NextResponse.json({
      ...cached,
      searchTimeMs: Date.now() - start,
      cached: true,
    });
  }

  const warnings: string[] = [];

  try {
    const resolved = await resolveUniversity(q);
    console.log(`[timing] resolve: ${Date.now() - start}ms`);
    if (resolved.ambiguous && resolved.candidates.length > 1) {
      warnings.push(
        `Запрос неоднозначен, использован наиболее вероятный вариант: "${resolved.resolvedName}". Другие варианты: ${resolved.candidates.slice(1, 4).join(", ")}.`
      );
    }
    const officialSiteSummaryPromise = resolved.officialWebsite
      ? fetchOfficialSiteSummary(resolved.officialWebsite)
      : Promise.resolve(null);

    const socialsPromise = (
      resolved.officialWebsite
        ? fetchOfficialSiteSocials(resolved.officialWebsite)
        : Promise.resolve([])
    ).then((fromSite) => mergeSocials(fromSite, resolved.socials));

    const rawCandidates = filterContentCandidates(
      await searchAllCategories(
        resolved.resolvedName,
        resolved.city,
        resolved.officialWebsite
      )
    );
    console.log(
      `[timing] search: ${Date.now() - start}ms, raw candidates: ${rawCandidates.length}`
    );

    if (rawCandidates.length === 0) {
      warnings.push("Изображения не найдены. Проверьте название университета.");
    }

    const descriptionPromise = Promise.all([
      officialSiteSummaryPromise,
      socialsPromise,
    ]).then(([officialSiteSummary, socials]) =>
      generateDescription(
        resolved.resolvedName,
        resolved.city,
        resolved.wikiSummary,
        officialSiteSummary,
        socials.map((s) => `${s.platform} ${s.handle ?? ""}`.trim())
      )
    );

    const deduped = await dedupeCandidates(rawCandidates);
    console.log(
      `[timing] dedup: ${Date.now() - start}ms, deduped: ${deduped.length}`
    );
    const toVerify = capWithDiversity(deduped, MAX_CANDIDATES_TO_VERIFY);

    const verified = await verifyBatch(toVerify, resolved.resolvedName, resolved.city);
    console.log(
      `[timing] verify: ${Date.now() - start}ms, verified: ${verified.length}`
    );

    const shown = verified.filter((v) => v.confidence >= MIN_CONFIDENCE_TO_SHOW);
    const lowConfidenceCount = shown.filter(
      (v) => v.confidence < LOW_CONFIDENCE_WARNING
    ).length;
    if (lowConfidenceCount > 0) {
      warnings.push(
        `${lowConfidenceCount} фото показаны с пониженной достоверностью — принадлежность университету не удалось подтвердить уверенно.`
      );
    }
    const droppedCount = verified.length - shown.length;
    if (droppedCount > 0) {
      warnings.push(
        `${droppedCount} фото скрыто как нерелевантные/неподтвержденные.`
      );
    }

    const categories: Partial<Record<Category, VerifiedImage[]>> = {};
    for (const cat of ALL_CATEGORIES) {
      const items = shown
        .filter((v) => v.category === cat)
        .sort((a, b) => b.confidence - a.confidence);
      if (items.length > 0) categories[cat] = items;
    }

    const description = await descriptionPromise;
    if (!resolved.wikiSummary && !(await officialSiteSummaryPromise)) {
      warnings.push("Не удалось найти проверенное текстовое описание университета.");
    }

    const profile: UniversityProfile = {
      query: q,
      resolvedName: resolved.resolvedName,
      city: resolved.city,
      country: resolved.country,
      website: resolved.officialWebsite,
      wikiUrl: resolved.wikiUrl,
      socials: await socialsPromise,
      description,
      categories,
      warnings,
      searchTimeMs: Date.now() - start,
      cached: false,
    };

    setCached(q, profile);
    return NextResponse.json(profile);
  } catch (err) {
    console.error("[route] error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Неизвестная ошибка",
        searchTimeMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
