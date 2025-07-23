#!/bin/bash

psql --dbname electric -c "CREATE PUBLICATION electric_publication_integration"
psql -c "CREATE ROLE low_privilege LOGIN PASSWORD 'password' REPLICATION"
