#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

cd "$SCRIPT_DIR"/../../packages/sync-service

# Until https://github.com/electric-sql/electric/issues/2415 is fixed,
# both ELECTRIC_PERSISTENT_STATE and ELECTRIC_STORAGE configs must be set explicitly
# for Electric to use the configured ELECTRIC_STORAGE_DIR.
ELECTRIC_STORAGE_DIR="$SCRIPT_DIR/../_storage" \
ELECTRIC_PERSISTENT_STATE=file \
ELECTRIC_STORAGE=file \
ELECTRIC_REPLICATION_STREAM_ID=integration \
iex -S mix
