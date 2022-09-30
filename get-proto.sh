#!/usr/bin/env bash

set -e

mkdir -p proto
cd proto
git clone \
  --depth 1  \
  --filter=blob:none  \
  --sparse \
  git@github.com:electric-sql/typescript-client.git satellite;
cd satellite
echo "Prepare sparse"
git sparse-checkout init --no-cone
git sparse-checkout set *.proto
git checkout 804a808d04ac488ca4fd6c291771ded23d322758
