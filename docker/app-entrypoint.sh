#!/bin/sh
set -eu

echo "Validating production environment"
node_modules/.bin/tsx scripts/validate-production-env.ts --environment
echo "Applying Prisma migrations"
npx prisma migrate deploy
echo "Starting application"
exec npm run start
