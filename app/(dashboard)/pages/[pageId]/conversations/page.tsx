import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { getPageById } from "@/services/pages/queries";
import { getPreviewConversations } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const page = await getPageById(pageId);
  if (!page) notFound();
  if (pageId !== page.slug) redirect(`/pages/${page.slug}/conversations`);
  const conversations = isDevPreview() ? getPreviewConversations(page.id) : [];
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}`}>Pages</Link> / Conversations</div><h1>Conversations</h1><p className="subtitle">Page-scoped Messenger conversations and AI-assisted sales activity.</p></div></div><PageTabs pageId={page.slug} active="Conversations" /><section className="card">{conversations.length === 0 ? <div className="empty-state"><h3>No conversations yet</h3><p>Messenger conversations for this Page will appear here.</p></div> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Last message</th><th>Status</th><th>Updated</th></tr></thead><tbody>{conversations.map((conversation) => <tr key={conversation.id}><td><div className="product-name">{conversation.customerName}</div><div className="field-hint">Conversation {conversation.id.slice(0, 8)}</div></td><td>{conversation.lastMessage}</td><td><span className="status-chip green"><span className="dot" />{conversation.status}</span></td><td>{conversation.updatedAt.toLocaleString()}</td></tr>)}</tbody></table></div>}</section></main>;
}
