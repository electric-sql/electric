#!/bin/bash

set -x

psql --dbname electric -c "CREATE ROLE electric_test LOGIN PASSWORD 'password' REPLICATION; GRANT CREATE ON DATABASE electric TO electric_test;"
