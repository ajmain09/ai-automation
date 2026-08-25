# Deployment

The complete production runbook is [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md). It covers upload/clone, `.env`, Docker Compose startup, Prisma migrations, Super Admin bootstrap, HTTPS verification, logs, backups, and restore.

The production topology is `app`, `worker`, `postgres`, and `caddy`. Only Caddy exposes ports 80 and 443. Redis and external automation services are not part of this system.

The canonical public URL is `https://ai.growthifyx.space`. Public policy and Meta routes are `/privacy`, `/data-deletion`, `/api/meta/oauth/callback`, and `/api/meta/webhook`.

For local preview, copy `.env.example` to `.env.local`, keep `NODE_ENV=development` and `DEV_PREVIEW=true`, then run `npm install` and `npm run dev`. Preview credentials are local-only and must never be copied to production.

Live PostgreSQL migration, Docker build/runtime, Caddy certificates, provider calls, and restore smoke testing remain VPS checks. Do not install Docker locally for this deployment-pack pass.
