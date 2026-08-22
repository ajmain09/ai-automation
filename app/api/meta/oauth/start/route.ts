import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { beginMetaOAuth } from "@/services/meta/service";

export async function GET() {
  await requireAdmin();
  redirect(await beginMetaOAuth());
}
