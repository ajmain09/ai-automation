#!/bin/sh
set -eu

echo "Validating worker environment"
node_modules/.bin/tsx scripts/validate-production-env.ts --environment --worker
echo "Starting PostgreSQL worker"
exec node_modules/.bin/tsx worker/index.ts
