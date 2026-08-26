import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPageById } from "@/services/pages/queries";
import { getPreviewConversations } from "@/services/preview/store";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({ params }: { params: Promise<{ pageId: string; conversationId: string }> }) {
  const { pageId, conversationId } = await params;
  const page = await getPageById(pageId);
  if (!page) notFound();
  if (pageId !== page.slug) redirect(`/pages/${page.slug}/conversations/${conversationId}`);
  const conversation = isDevPreview() ? getPreviewConversations(page.id).find((item) => item.id === conversationId) : await prisma.conversation.findFirst({ where: { id: conversationId, pageId: page.id }, include: { customer: true, messages: { orderBy: { createdAt: "asc" }, take: 100 } } });
  if (!conversation) notFound();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}/conversations`}>Inbox</Link> / Conversation</div><h1>{"customer" in conversation ? conversation.customer?.name ?? "Unknown customer" : "Conversation"}</h1><p className="subtitle">Page-scoped message history for {page.name}. Showing the latest 100 messages.</p></div></div><section className="card"><div className="locked-list">{"messages" in conversation ? conversation.messages.map((message) => <div key={message.id}><strong>{message.direction === "INBOUND" ? "Customer" : "AI / Admin"}</strong> · {message.createdAt.toLocaleString()}<div>{message.text ?? "[non-text message]"}</div></div>) : <div>Preview conversation history is represented by the fixture summary.</div>}</div></section></main>;
}
