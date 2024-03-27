#!/usr/bin/env bash

set -ex

tunnel_port="65333"

yarn

npx electric-sql proxy-tunnel --local-port "${tunnel_port}" &

proxy_test="import socket; import sys; sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM); result = sock.connect_ex((\"127.0.0.1\",${tunnel_port})); sock.close(); sys.exit(result)"

while ! python -c "$proxy_test"; do
    sleep 0.5
done


yarn client:generate \
    --service "${ELECTRIC_SERVICE}" \
    --proxy "postgresql://postgres:${PG_PROXY_PASSWORD}@localhost:${tunnel_port}/postgres"

yarn build

