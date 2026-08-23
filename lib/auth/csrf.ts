import { getEnv, isDevPreview } from "@/lib/env";

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const expected = isDevPreview() ? "http://localhost:3000" : getEnv().APP_URL;
    return new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}
