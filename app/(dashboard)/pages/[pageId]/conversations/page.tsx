import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { getPageById, getPageConversations } from "@/services/pages/queries";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const page = await getPageById(pageId);
  if (!page) notFound();
  if (pageId !== page.slug) redirect(`/pages/${page.slug}/conversations`);
  const result = await getPageConversations(page.id);
  const conversations = Array.isArray(result) ? result : result.items;
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}`}>Pages</Link> / Inbox</div><h1>Inbox</h1><p className="subtitle">Customer conversations for {page.name}, ordered by most recent activity.</p></div></div><PageTabs pageId={page.slug} active="Conversations" /><section className="card">{conversations.length === 0 ? <div className="empty-state"><h3>No conversations yet</h3><p>Messenger conversations for this Page will appear here.</p></div> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Last message</th><th>Messages</th><th>Updated</th></tr></thead><tbody>{conversations.map((conversation) => { const last = "messages" in conversation ? conversation.messages[0] : null; const customerName = "customer" in conversation ? conversation.customer?.name ?? "Unknown customer" : conversation.customerName; return <tr key={conversation.id}><td><Link href={`/pages/${page.slug}/conversations/${conversation.id}`} className="text-link"><div className="product-name">{customerName}</div><div className="field-hint">{"customer" in conversation ? conversation.customer?.phone ?? "No phone" : `Conversation ${conversation.id.slice(0, 8)}`}</div></Link></td><td>{last?.text ?? ("lastMessage" in conversation ? conversation.lastMessage : "No text message")}</td><td>{"_count" in conversation ? conversation._count.messages : "—"}</td><td>{conversation.updatedAt.toLocaleString()}</td></tr>; })}</tbody></table></div>}</section></main>;
}
