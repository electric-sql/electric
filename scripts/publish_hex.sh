#!/bin/bash

set -e

# Publish an Elixir package to hex.pm, skipping if the version already exists.
#
# Usage: ./scripts/publish_hex.sh <hex_package_name>
#
# Examples:
#   ./scripts/publish_hex.sh electric_client
#   ./scripts/publish_hex.sh electric

if [ -z "$1" ]; then
  echo "Usage: $0 <hex_package_name>"
  echo "Example: $0 electric_client"
  exit 1
fi

HEX_PACKAGE_NAME="$1"
VERSION=$(node -p "require('./package.json').version")

echo "Checking if ${HEX_PACKAGE_NAME} version ${VERSION} exists on hex.pm..."

if curl -sf "https://hex.pm/api/packages/${HEX_PACKAGE_NAME}/releases/${VERSION}" > /dev/null; then
  echo "Version ${VERSION} already published to hex.pm, skipping"
  exit 0
fi

echo "Version ${VERSION} not found on hex.pm, publishing..."
mix do deps.get + hex.publish --yes
