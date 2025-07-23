#!/bin/bash

set -x

if [ "$LOW_PRIVILEGE_TEST_CREATE_PUBLICATION_SQL" = "null" ]; then
  # noop
  echo
elif [ -n "$LOW_PRIVILEGE_TEST_CREATE_PUBLICATION_SQL" ]; then
  psql --dbname electric -c "$LOW_PRIVILEGE_TEST_CREATE_PUBLICATION_SQL"
else
  psql --dbname electric -c "CREATE PUBLICATION electric_publication_integration"
fi

psql -c "CREATE ROLE low_privilege LOGIN PASSWORD 'password' REPLICATION"
