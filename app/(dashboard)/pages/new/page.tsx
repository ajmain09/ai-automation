import { OnboardingWizard } from "@/components/pages/onboarding-wizard";
import { isDevPreview } from "@/lib/env";

export default function NewPage() { return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">New page</div><h1>Set up your page</h1><p className="subtitle">Three clear steps to prepare a page for review and future go-live.</p></div></div><OnboardingWizard previewMode={isDevPreview()} /></main>; }
