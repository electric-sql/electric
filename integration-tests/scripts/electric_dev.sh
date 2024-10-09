#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

cd "$SCRIPT_DIR"/../../packages/sync-service
STORAGE_DIR="$SCRIPT_DIR/../_storage" iex -S mix
