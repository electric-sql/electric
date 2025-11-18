#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

cd "$SCRIPT_DIR"/../../packages/sync-service

ELECTRIC_STORAGE_DIR="$SCRIPT_DIR/../_storage" ELECTRIC_REPLICATION_STREAM_ID=integration iex -r "$SCRIPT_DIR/../test_utils/*.exs" "$@" -S mix
