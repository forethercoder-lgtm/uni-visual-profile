import sharp from "sharp";
import { fetchWithUA } from "./http";
import { fetchableUrl, ImageCandidate } from "./types";

// 8x8 grayscale average hash — cheap perceptual fingerprint good enough to
// catch exact/near-duplicate photos re-uploaded across different sources.
async function averageHash(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetchWithUA(imageUrl, 6000);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());

    const raw = await sharp(buf)
      .resize(8, 8, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer();

    const avg = raw.reduce((sum, v) => sum + v, 0) / raw.length;
    let hash = "";
    for (const v of raw) hash += v >= avg ? "1" : "0";
    return hash;
  } catch {
    return null;
  }
}

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

const DUPLICATE_THRESHOLD = 6; // out of 64 bits — near-identical images

export async function dedupeCandidates<T extends ImageCandidate>(
  candidates: T[],
  concurrency = 6
): Promise<T[]> {
  const hashes: (string | null)[] = new Array(candidates.length).fill(null);

  let index = 0;
  async function worker() {
    while (index < candidates.length) {
      const i = index++;
      hashes[i] = await averageHash(fetchableUrl(candidates[i]));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker)
  );

  const kept: T[] = [];
  const keptHashes: string[] = [];

  candidates.forEach((candidate, i) => {
    const hash = hashes[i];
    if (!hash) {
      // Couldn't fetch/hash it (broken link, blocked, etc.) — drop it rather
      // than risk showing a dead or unverifiable image.
      return;
    }
    const isDuplicate = keptHashes.some(
      (h) => hammingDistance(h, hash) <= DUPLICATE_THRESHOLD
    );
    if (!isDuplicate) {
      kept.push(candidate);
      keptHashes.push(hash);
    }
  });

  return kept;
}
