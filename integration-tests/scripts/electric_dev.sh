#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

cd "$SCRIPT_DIR"/../../packages/sync-service
STORAGE_DIR="$SCRIPT_DIR/../_storage" REPLICATION_STREAM_ID=integration iex -S mix
