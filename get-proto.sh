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
git checkout bd81a40f328896571c782ceb53f2b298568f62bc
