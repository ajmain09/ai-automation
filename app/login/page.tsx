import { LoginForm } from "@/components/auth/login-form";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <main className="login-page"><div className="login-shell">
    <div className="login-mark"><div className="brand-mark">G</div></div>
    <section className="login-card">
      <div className="eyebrow" style={{ textAlign: "center" }}>Private operations console</div>
      <h1>Welcome back</h1>
      <p className="subtitle">Sign in to manage your Facebook Messenger sales system.</p>
      {isDevPreview() && <div className="callout info" style={{ marginBottom: 18 }}><span className="callout-icon">i</span><span>Local preview credentials<br /><strong>admin@local.test</strong> / <strong>Admin123!</strong></span></div>}
      <LoginForm />
    </section>
    <p className="login-footer">Growthifyx AI Sales · One Super Admin</p>
  </div></main>;
}
