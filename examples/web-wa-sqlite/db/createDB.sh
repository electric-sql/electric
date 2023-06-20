#!/bin/sh

# Create empty DB
touch dev.db

# Create some table(s)
sqlite3 dev.db ".read \"initialMigration.sql\"" ".exit"
