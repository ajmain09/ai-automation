import { getEnv, isDevPreview } from "@/lib/env";

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    if (isDevPreview()) {
      const candidate = new URL(origin);
      return candidate.protocol === "http:" && ["localhost", "127.0.0.1"].includes(candidate.hostname);
    }
    const expected = getEnv().APP_URL!;
    return new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}
