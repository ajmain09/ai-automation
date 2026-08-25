import { DataDeletionForm } from "@/components/data-deletion-form";

export const dynamic = "force-dynamic";

export default function DataDeletionPage() {
  return <main className="policy-page"><div className="policy-shell"><p className="eyebrow">Growthifyx AI Sales</p><h1>Data deletion</h1><p className="subtitle">Facebook data deletion requests are handled by the single system administrator.</p><section className="card card-pad"><h2>How to request deletion</h2><p className="policy-copy">Submit the request through the Facebook app or Page connection flow, or contact the administrator directly. The administrator verifies the request, identifies the affected Page and customer, removes non-required stored records, anonymizes preserved order data, and records an audit event.</p><p className="policy-copy">Requests involving order records or legally required retention are reviewed before deletion. Execution requires an authenticated administrator session and an idempotent request key.</p></section><div style={{ marginTop: 20 }}><DataDeletionForm /></div></div></main>;
}
