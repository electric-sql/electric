#!/bin/bash
set -e

if [ -z "$1" ]
  then
    echo "Specify the migration using \`make apply_migration name=<migration folder name>\`."

    exit 1
fi

data="{\"vsn\":\"$1\"}"
json='Content-Type: application/json'

curl -v -X PUT http://localhost:5050/api/migrations/postgres_1 -H $json -d $data
curl -v -X PUT http://localhost:5050/api/migrations/postgres_2 -H $json -d $data
