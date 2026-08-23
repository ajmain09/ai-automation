import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { beginMetaOAuth } from "@/services/meta/service";
import { isDevPreview } from "@/lib/env";

export async function GET() {
  await requireAdmin();
  if (isDevPreview()) redirect("/pages/new");
  redirect(await beginMetaOAuth());
}
