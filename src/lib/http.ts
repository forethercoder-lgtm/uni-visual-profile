// Wikimedia (and good API etiquette generally) requires a descriptive
// User-Agent identifying the app; requests without one get throttled/blocked
// with a 429 "Too many requests" HTML page instead of the actual bytes.
export const USER_AGENT =
  "uni-visual-profile/1.0 (LOCUS Hackathon 2026 project; contact: forethercoder@gmail.com)";

export function fetchWithUA(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
