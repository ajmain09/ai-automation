import { getEnv, isDevPreview } from "@/lib/env";

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (isDevPreview()) return true;
    const fetchSite = request.headers.get("sec-fetch-site");
    return fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";
  }
  try {
    if (isDevPreview()) {
      const candidate = new URL(origin);
      return candidate.protocol === "http:" && ["localhost", "127.0.0.1"].includes(candidate.hostname);
    }
    const expected = getEnv().APP_URL!;
    return new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}
