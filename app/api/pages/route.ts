import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";

const schema = z.object({ name: z.string().trim().min(1).max(160) });
export async function POST(request: Request) { if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }); await requireAdmin(); const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "A page name is required." }, { status: 400 }); const slug = `${parsed.data.name}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"); const page = await prisma.page.create({ data: { name: parsed.data.name, slug, settings: { create: { requiredOrderFields: ["name", "phone", "address", "product", "variant", "quantity"] } }, configurationVersions: { create: { version: 1, status: "DRAFT", label: "Initial draft" } }, connection: { create: { status: "DISCONNECTED" } } } }); return NextResponse.json({ ok: true, id: page.id }); }
