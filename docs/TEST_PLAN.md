# Step 1 Test Plan

Run from the project root:

```bash
npm install
npx prisma validate
npx prisma migrate dev --name init
npm run lint
npm run typecheck
npm test
npm run build
docker compose build
```

For a local development environment, copy `.env.example` to `.env`, start PostgreSQL with `docker compose up postgres`, run the migration and seed, then start the app with `npm run dev`. The first login uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment.
