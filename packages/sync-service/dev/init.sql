-- CREATE PUBLICATION electric_publication_default;

-- Unprivileged role for use in tests.
CREATE ROLE unprivileged LOGIN PASSWORD 'password' REPLICATION;

-- An enum type for tests. Since enum types are global per Postgres cluster, it's easier to set
-- one up here than to manage their lifetimes in test setup code.
CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3');
