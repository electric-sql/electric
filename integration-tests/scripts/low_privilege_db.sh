#!/bin/bash

set -x

psql --dbname electric -c "CREATE ROLE low_privilege LOGIN PASSWORD 'password' REPLICATION; $LOW_PRIVILEGE_TEST_INIT_SQL"
