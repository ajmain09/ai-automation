# Deployment

The production topology is `app`, `worker`, `postgres`, and `caddy` from `docker-compose.yml`. The canonical public URL is `https://ai.growthifyx.space`. Redis and external automation services are not part of this system.

1. Provision a VPS with Docker/Compose, persistent PostgreSQL storage, and DNS for the domain.
2. Copy the repository and create a production environment file from `.env.example`; set every secret explicitly, including `POSTGRES_PASSWORD`, and never commit it. Use `DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<database>?schema=public` for the Compose network.
3. Run `docker compose up -d --build`.
4. Run `npx prisma migrate deploy` from the app container.
5. Bootstrap the one Super Admin through the approved recovery/bootstrap procedure. Do not use the example password.
6. Check worker logs, Caddy HTTPS for `ai.growthifyx.space`, and PostgreSQL connectivity.
7. Configure Meta, DeepSeek, Telegram, and each Page. Run readiness checks before going LIVE.

Local Docker build, live migration, provider calls, and HTTPS certificate checks are DEFERRED TO VPS. Windows development must not install Docker or replace PostgreSQL with SQLite.
