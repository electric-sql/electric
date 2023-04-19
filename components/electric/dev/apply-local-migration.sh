#!/bin/bash
set -e

if [ -z "$1" ]
  then
    echo "Specify the migration using \`make apply_migration name=<migration folder name>\`."

    exit 1
fi

curl -v -X PUT http://localhost:5050/api/migrations/postgres_1 -H 'Content-Type: application/json' -d "{\"vsn\":\"${1}\"}"
curl -v -X PUT http://localhost:5050/api/migrations/postgres_2 -H 'Content-Type: application/json' -d "{\"vsn\":\"${1}\"}"
