# Deployment

The production topology is `app`, `worker`, `postgres`, and `caddy` from `docker-compose.yml`. The canonical public URL is `https://ai.growthifyx.space`. Redis and external automation services are not part of this system.

Canonical public endpoints: `https://ai.growthifyx.space/api/meta/oauth/callback`, `https://ai.growthifyx.space/api/meta/webhook`, `https://ai.growthifyx.space/privacy`, and `https://ai.growthifyx.space/data-deletion`.

## Local preview

The database-free preview is intended for local development only. `.env.local` is development-only, ignored by Git, and must never be copied to production.

```text
npm install
npm run dev
```

Open `http://localhost:3000/login` and use:

```text
admin@local.test
Admin123!
```

Preview mode uses fixture data and does not require PostgreSQL, Docker, Meta, DeepSeek, or Telegram credentials. To start from the template, copy `.env.example` to `.env.local` and keep `DEV_PREVIEW=true` with `NODE_ENV=development`.

## Production VPS env

Provision a VPS with Docker/Compose, persistent PostgreSQL storage, and DNS for the domain. Copy `.env.production.example` to the VPS as `.env`, then replace every blank value with real credentials. Never commit the production `.env`. Use `DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<database>?schema=public` for the Compose network.

1. Set `APP_URL=https://ai.growthifyx.space`, the canonical Meta callback/webhook URLs, a random `SESSION_SECRET`, and a separate random `APP_ENCRYPTION_KEY`.
2. Set the one Super Admin bootstrap credentials, Meta credentials, and DeepSeek key. Telegram values are only needed when Telegram delivery is enabled.
3. Set `POSTGRES_PASSWORD` for the Compose database and run `docker compose up -d --build`.
4. Run `npx prisma migrate deploy` from the app container.
5. Check worker logs, Caddy HTTPS for `ai.growthifyx.space`, and PostgreSQL connectivity.
6. Configure each Page and run readiness checks before going LIVE.

Local Docker build, live migration, provider calls, and HTTPS certificate checks are DEFERRED TO VPS. Windows development must not install Docker or replace PostgreSQL with SQLite.
