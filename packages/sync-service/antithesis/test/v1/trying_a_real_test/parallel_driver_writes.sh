#!/usr/bin/env bash
set -ex

DB_URL="postgresql://postgres:password@postgres:5432/electric?sslmode=disable"

# Insert a random number of rows into the users table, but no more than 1000 at a time.
# Generate random number between 10-1000 using /dev/random
ROW_COUNT=$(( ( $(od -An -N2 -t u2 /dev/random) % 991 ) + 10 ))

attempts=0
max_attempts=10
# Although generally PG is always available, sometimes antithesis fault makes it drop a connection or seem busier than it is.
# So we retry a few times. The error we "expect" here is an authentication timeout.
while [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    if psql $DB_URL -c "INSERT INTO users SELECT gen_random_uuid(), name, name || '@corporate.domain'  FROM (SELECT gen_random_uuid()::text name FROM generate_series(1, $ROW_COUNT)) _ ;"; then
        break
    fi
    sleep 1
done
if [ $attempts -eq $max_attempts ]; then exit 1; fi
