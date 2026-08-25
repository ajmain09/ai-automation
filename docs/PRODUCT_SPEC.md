# Product Specification — Step 1

Growthifyx AI Sales is a private, single-admin, multi-page Facebook Messenger AI sales system. It is not a SaaS product and has no tenants, subscriptions, billing, client accounts, CRM, flow builder, or staff roles.

The only analytics planned is AI API usage per Facebook Page. Each Page owns isolated business data, products, variants, policies, customers, conversations, orders, memory, AI configuration, Telegram configuration, cost controls, provider balance, and AI usage. All relevant queries must be scoped by `page_id`.

Onboarding has exactly three visible steps:

1. Connect Facebook Page
2. Business Setup
3. Review & Go Live

Global Settings is limited to General, Meta Platform, Security, and System Health. Meta remains global; DeepSeek, Telegram, AI pricing, FX, budgets, and usage are Page-scoped. Step 1 provides the UI and state boundaries only; live Meta, AI-provider, and Telegram calls remain deferred.
