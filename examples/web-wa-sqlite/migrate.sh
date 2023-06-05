#!/bin/sh

# This script generates a client based on SQL migration files.
# It imports the migrations into a fresh DB, introspects it to build a Prisma schema, and then generates a client.
# Usage example:
#  sh migrate.sh -p prisma/schema.prisma

# Arguments are based on: https://unix.stackexchange.com/questions/31414/how-can-i-pass-a-command-line-argument-into-a-shell-script

helpFunction()
{
   echo ""
   echo "Usage: $0 -p prismaSchema"
   echo -e "\t-p The path to the file containing the Prisma schema."
   exit 1 # Exit script after printing help
}

while getopts "p:" opt
do
   case "$opt" in
      p ) prisma="$OPTARG" ;;
      ? ) helpFunction ;; # Print helpFunction in case parameter is non-existent
   esac
done

if [ -z "$prisma" ]
then
   echo "Path to Prisma schema is missing.";
   helpFunction
fi

# Make migrations folder if it does not already exist
mkdir -p migrations

# Fetch the migrations from Electric endpoint
cd migrations
#wget --no-parent -r "link/to/endpoint"
cd ..

# Replace the data source in the Prisma schema to be SQLite
sed -i'' -e 's/provider = "postgresql"/provider = "sqlite"/' $prisma
sed -i'' -e "s/env(\"PRISMA_DB_URL\")/\"file:electric-tmp.db\"/" $prisma

# Create empty temporary DB
touch prisma/electric-tmp.db

# Migrate the DB to the current state of the Prisma schema
# NOTE: is not needed if we store all migrations (also migrations that were already applied)
#npx prisma db push --skip-generate

# Apply the missing migrations
# NOTE: the loop will apply the migrations in alphabetical order!
#       Thus, the names of the migrations must reflect their order
for m in migrations/*/;
do
  sqlite3 prisma/electric-tmp.db ".read \"${m}migration.sql\"" ".exit"
done

# Introspect the created DB to generate the Prisma schema
npx prisma db pull --schema=$prisma

# Modify the data source back to Postgres
# because Prisma won't generate createMany/updateMany/... schemas
# if the data source is a SQLite DB.
sed -i'' -e 's/provider = "sqlite"/provider = "postgresql"/' $prisma
sed -i'' -e "s/\"file:electric-tmp.db\"/env(\"PRISMA_DB_URL\")/" $prisma

# Generate a client from the Prisma schema
npx prisma generate --schema=$prisma

# Delete the DB file
rm prisma/electric-tmp.db

# Fix the capitalization issues in the generated Prisma client
sed -i'' -e 's/itemsAggregateArgs/ItemsAggregateArgs/g' prisma/generated/models/index.ts
sed -i'' -e 's/itemsGroupByArgs/ItemsGroupByArgs/g' prisma/generated/models/index.ts

rm prisma/generated/models/index.ts-e
rm prisma/schema.prisma-e
