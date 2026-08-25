import { OnboardingWizard } from "@/components/pages/onboarding-wizard";
import { isDevPreview } from "@/lib/env";

export default function NewPage() { return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">New page</div><h1>Set up your page</h1><p className="subtitle">Connect the Page, review its business details, and take it live when the checklist passes.</p></div></div><OnboardingWizard previewMode={isDevPreview()} /></main>; }
