import { getEnv } from "@/lib/env";

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(getEnv().APP_URL).origin; } catch { return false; }
}
