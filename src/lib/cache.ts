import { UniversityProfile } from "./types";

interface CacheEntry {
  profile: UniversityProfile;
  cachedAt: number;
}

// Module-level state persists across requests on the same warm serverless
// instance (not guaranteed long-term, but makes repeat lookups of the same
// university — common when a jury re-tests — return near-instantly instead
// of re-running the whole external-API pipeline).
const store = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

function normalize(key: string): string {
  return key.trim().toLowerCase().replace(/[\s\-_]+/g, " ");
}

export function getCached(key: string): UniversityProfile | null {
  const entry = store.get(normalize(key));
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    store.delete(normalize(key));
    return null;
  }
  return entry.profile;
}

export function setCached(key: string, profile: UniversityProfile): void {
  store.set(normalize(key), { profile, cachedAt: Date.now() });
}
