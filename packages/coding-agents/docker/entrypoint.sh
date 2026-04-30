#!/usr/bin/env bash
set -euo pipefail
# If args are passed (e.g. `docker run image claude --version`), run them.
# Otherwise PID 1 just stays alive so docker exec can attach.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec tail -f /dev/null
