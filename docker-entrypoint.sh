#!/bin/sh
# Container start-up: bring the schema up to date, then run the API.
#
# Compose waits for the postgres healthcheck before starting this container, so
# the database is reachable by the time we get here. The migration runner tracks
# what it has applied in `_migrations`, so running it on every boot is a no-op
# once the schema is current.
set -e

echo "==> applying migrations"
node --experimental-strip-types server/src/db/migrate.ts

# Demo data is opt-in: useful for a throwaway instance, wrong for a real one.
# The seed is idempotent, so a repeated boot will not duplicate anything.
if [ "$SEED_ON_START" = "true" ] || [ "$SEED_ON_START" = "1" ]; then
  echo "==> seeding demo data"
  node --experimental-strip-types server/src/db/seed.ts
fi

echo "==> starting API"
exec node --experimental-strip-types server/src/index.ts
