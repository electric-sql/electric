#!/bin/bash

# This is a script that solves inconsistencies for the tauri linearlite demo
# At the end, this file should be empty/deleted

sed -i 's/WITHOUT ROWID//g' src/generated/client/migrations.ts
