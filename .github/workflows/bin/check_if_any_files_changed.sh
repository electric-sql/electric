#!/usr/bin/bash

set -ex

protoc --version
git status --porcelain
git diff -p

for file in $(git status --porcelain | awk '{ print $2 }')
do
  echo "::error file=$file,title=This generated file doesn't match the protobuf file::Please run \`make update_protobuf\` to update \`$file\` and commit the changes."
done

if [ -n "`git status --porcelain`" ]; then
  exit 1
fi
