#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

LUX_BIN="$SCRIPT_DIR/lux/bin/lux"
LUX="$LUX_BIN --multiplier=${TIMEOUT_MULTIPLIER:-1000}"

$LUX ${@:-tests/*.lux}
