#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

TMP_DIR=$(mktemp -d)
SUPPORT_DIR="$SCRIPT_DIR/../support_files"

echo ">>> Generating root certificate"

# Generate a private key for the root certificate
openssl ecparam -out "$TMP_DIR/root.key" -name prime256v1 -genkey

# Generate the root certificate
openssl req -new -sha256 -subj "/C=XX/CN=root" -key "$TMP_DIR/root.key" -out "$TMP_DIR/root.csr"
openssl x509 -req -sha256 -days 365 -in "$TMP_DIR/root.csr" -signkey "$TMP_DIR/root.key" -out "$SUPPORT_DIR/root.crt"

# Generate a new private key for the server certificate
openssl ecparam -out "$SUPPORT_DIR/server.key" -name prime256v1 -genkey

echo
echo ">>> Generating server certificate"

# Generate the server certificate
openssl req -new -sha256 -subj "/C=XX/CN=localhost" -key "$SUPPORT_DIR/server.key" -out "$TMP_DIR/server.csr"
openssl x509 -req -in "$TMP_DIR/server.csr" -CA "$SUPPORT_DIR/root.crt" -CAkey "$TMP_DIR/root.key" \
    -out "$SUPPORT_DIR/server.crt" -days 365 -sha256

rm -r "$TMP_DIR"
