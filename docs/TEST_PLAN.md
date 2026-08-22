# Step 2 Test Plan

Run from the project root:

```bash
npm install
npx prisma validate
npx prisma migrate dev --name init
npm run lint
npm run typecheck
npm test
npm run build
```

For a local development environment, copy `.env.example` to `.env`, start PostgreSQL with `docker compose up postgres`, run the migration and seed, then start the app with `npm run dev`. The first login uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment.

Because local PostgreSQL/Docker are unavailable for this phase, unit and mocked integration coverage exercises page isolation, queue idempotency and ordering, debounce, stale/manual/expired reply protection, memory correction, semantic anti-repeat, product ranking, malformed AI output, and bounded context. Runtime-only Meta/DeepSeek/PostgreSQL checks are explicitly external or deferred to VPS validation.
