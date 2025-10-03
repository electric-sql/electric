#!/bin/bash

set -e

# This script generates a random WAL position and uses pg_resetwal to reset the WAL to that position.
# This also requires restarting Postgres if ran as an initdb script, which is recommended
# as it requires appropriate user privileges.

# Generate a random timeline ID (1, 2, or 3)
timeline_id=$((RANDOM % 3 + 1))

# Generate two random 32-bit hexadecimal values for the log segment and offset
log_segment=$(printf "%08X" $(( (RANDOM << 17) | (RANDOM << 2) | (RANDOM % 4) )))
log_offset=$(printf "%08X" $(( (RANDOM << 17) | (RANDOM << 2) | (RANDOM % 4) )))

# Combine into WAL format
wal_pos=${ELECTRIC_PG_START_WAL:-$(printf "%08X%s%s" $timeline_id $log_segment $log_offset)}

# Stop PostgreSQL to run pg_resetwal
pg_ctl stop -D $PGDATA

# Run pg_resetwal with the generated LSN
echo "Resetting WAL to $wal_pos"
pg_resetwal -l $wal_pos $PGDATA

# Restart PostgreSQL
pg_ctl start -D $PGDATA
