#!/bin/bash

# Generate a random timeline ID (1, 2, or 3)
timeline_id=$((RANDOM % 3 + 1))

# Generate two random 32-bit hexadecimal values for the log segment and offset
log_segment=$(printf "%08X" $(( (RANDOM << 17) | (RANDOM << 2) | (RANDOM % 4) )))
log_offset=$(printf "%08X" $(( (RANDOM << 17) | (RANDOM << 2) | (RANDOM % 4) )))

# Combine into WAL format
ELECTRIC_PG_START_WAL=00000001FFFFFFFF000000FF
wal_pos=${ELECTRIC_PG_START_WAL:-$(printf "%08X%s%s" $timeline_id $log_segment $log_offset)}

# Stop PostgreSQL to run pg_resetwal
pg_ctl stop -D /var/lib/postgresql/data

# Run pg_resetwal with the generated LSN
echo "Resetting WAL to $wal_pos"
pg_resetwal -l $wal_pos /var/lib/postgresql/data

# Restart PostgreSQL
pg_ctl start -D /var/lib/postgresql/data