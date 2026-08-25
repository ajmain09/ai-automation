import { getOpenIssues } from "@/services/issues/service";
import { IssueActions } from "@/components/issues/issue-actions";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const issues = await getOpenIssues();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">Operations</div><h1>Issues</h1><p className="subtitle">Only actionable problems requiring operator attention appear here.</p></div></div><section className="card">{issues.length === 0 ? <div className="empty-state"><div className="empty-icon">✓</div><h3>Everything is running normally</h3><p>There are no open issues requiring operator attention.</p><span className="status-chip green"><span className="dot" /> All clear</span></div> : <div className="table-wrap"><table><thead><tr><th>Issue</th><th>Page</th><th>Type</th><th>Status</th><th>Action</th></tr></thead><tbody>{issues.map((issue) => <tr key={issue.id}><td><div className="product-name">{issue.title}</div><div className="field-hint">{issue.description}</div></td><td>{issue.page?.name ?? "System"}</td><td>{issue.type}</td><td><span className={`status-chip ${issue.severity === "high" ? "red" : "amber"}`}><span className="dot" />{issue.status}</span></td><td><IssueActions issueId={issue.id} /></td></tr>)}</tbody></table></div>}</section></main>;
}
