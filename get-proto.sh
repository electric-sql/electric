#!/usr/bin/env bash

set -e

mkdir -p proto
cd proto
git clone \
  --depth 1  \
  --filter=blob:none  \
  --sparse \
  git@github.com:vaxine-io/electric-sql-ts.git satellite;
cd satellite
echo "Prepare sparse"
git sparse-checkout init --no-cone
git sparse-checkout set *.proto
git checkout 0cc637b8c548c46da5117add5a9474753b4388b9
