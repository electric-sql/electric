#!/usr/bin/env bash

set -e

mkdir -p proto
cd proto
git clone \
  --depth 1  \
  --filter=blob:none  \
  --sparse \
  git@github.com:vaxine-io/satellite-js.git satellite;
cd satellite
echo "Prepare sparse"
git sparse-checkout init --no-cone
git sparse-checkout set *.proto
git checkout 7ff60ccaa4edc44121f49631cb19c1fce2e8f21c
