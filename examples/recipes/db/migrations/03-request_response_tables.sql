/* This is an example of an SQL DDL migration. It creates an `items` table and
 * then calls an `electric.electrify` procedure to expose the table to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

-- Create a requests table.
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  data JSONB,
  processing BOOLEAN NOT NULL,
  cancelled BOOLEAN NOT NULL

);

-- Create a responses table referencing requests.
CREATE TABLE IF NOT EXISTS responses (
  id UUID PRIMARY KEY NOT NULL,
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status_code INTEGER NOT NULL,
  data JSONB
);

-- ⚡
-- Electrify the requests and responses table
ALTER TABLE requests ENABLE ELECTRIC;
ALTER TABLE responses ENABLE ELECTRIC;


/* Set up the triggers that will notify the appropriate APIs and perform
 * the work required to process incoming requests on the requests table
 * and generate responses to be added to the responses table, which will
 * in turn sync with the client and simulate an request/response pattern
 */

-- When request is received, set it as processing notify API to process it
CREATE OR REPLACE FUNCTION process_request()
RETURNS TRIGGER AS $$
BEGIN
  NEW.processing := true;
  PERFORM pg_notify('api_trigger', row_to_json(NEW)::TEXT);
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- When response is received, mark relevant request as processed
CREATE OR REPLACE FUNCTION finish_processing_request()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE requests SET "processing" = 'false' WHERE "id" = NEW.request_id;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Create a trigger to execute the function on INSERT into "requests" table
CREATE TRIGGER "process_request_trigger"
BEFORE INSERT ON requests
FOR EACH ROW
EXECUTE FUNCTION process_request();

-- Create a trigger to execute the function on INSERT into "responses" table
CREATE TRIGGER "finish_processing_request_trigger"
AFTER INSERT ON responses
FOR EACH ROW
EXECUTE FUNCTION finish_processing_request();

-- Enable the triggers on the tables
ALTER TABLE requests ENABLE ALWAYS TRIGGER process_request_trigger;
ALTER TABLE responses ENABLE ALWAYS TRIGGER finish_processing_request_trigger;
