#!/bin/bash

set -x

psql --dbname electric -c "$INIT_DB_SQL"
