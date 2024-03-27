#!/usr/bin/env bash

set -x

# https://stackoverflow.com/a/2173421
# kill all child processes when terminating
trap "trap - SIGTERM && kill -- -$$ 2>/dev/null || true" SIGINT SIGTERM EXIT

tunnel_port="65333"

npm install || exit 1

npx electric-sql proxy-tunnel --local-port "${tunnel_port}" &

tunnel_pid=$!

proxy_test="import socket; import sys; sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM); result = sock.connect_ex((\"127.0.0.1\",${tunnel_port})); sock.close(); sys.exit(result)"

while ! python -c "$proxy_test"; do
    sleep 0.5
done


yarn client:generate \
    --service "${ELECTRIC_SERVICE}" \
    --proxy "postgresql://postgres:${PG_PROXY_PASSWORD}@localhost:${tunnel_port}/postgres" || exit 1

yarn build || exit 1

kill "${tunnel_pid}"
wait "${tunnel_pid}"

exit 0
