CREATE ROLE min_privilege REPLICATION LOGIN PASSWORD 'password';

-- Needed to create to "electric" schema and "electric_publication"
GRANT CREATE ON DATABASE electric TO min_privilege;
