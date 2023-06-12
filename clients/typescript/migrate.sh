#!/bin/sh

# This script generates a client from a SQL file representing a dump of the DB and your Prisma schema.
# It imports the dump into a fresh DB, introspects it based on your Prisma schema, and then generates a client.
# Usage example:
#  sh migrate.sh -f test.sql -p schema.prisma

# Based on: https://unix.stackexchange.com/questions/31414/how-can-i-pass-a-command-line-argument-into-a-shell-script

helpFunction()
{
   echo ""
   echo "Usage: $0 -f sqlFile -p prismaSchema"
   echo -e "\t-f The path to the SQL file containing the migration."
   echo -e "\t-p The path to the file containing the Prisma schema."
   exit 1 # Exit script after printing help
}

while getopts "f:p:" opt
do
   case "$opt" in
      f ) file="$OPTARG" ;;
      p ) prisma="$OPTARG" ;;
      ? ) helpFunction ;; # Print helpFunction in case parameter is non-existent
   esac
done

# Print helpFunction in case a parameter is missing
if [ -z "$file" ]
then
   echo "Path to SQL file is missing.";
   helpFunction
fi

if [ -z "$prisma" ]
then
   echo "Path to Prisma schema is missing.";
   helpFunction
fi

# Fetch the SQL file from the endpoint
#curl -L "link/to/endpoint/$file" > "$file";

# Create a SQLite DB and import the schema and data defined by the sql file
printf ".read \"$file\"\n.exit" | sqlite3 electric-tmp.db

# Replace the data source in the Prisma schema to be SQLite
sed -i'' -e 's/provider = "postgresql"/provider = "sqlite"/' $prisma
sed -i'' -e "s/env(\"PRISMA_DB_URL\")/\"file:electric-tmp.db\"/" $prisma

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
rm electric-tmp.db
#rm "$file"
