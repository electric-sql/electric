/* This is an example of an SQL DDL migration. It creates tables and
 * then calls an `electric.electrify` procedure to expose the tables to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

-- Create a background jobs table.
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL,
  cancelled BOOLEAN NOT NULL,
  progress REAL NOT NULL,
  result JSONB
);

-- ⚡
-- Electrify the table
ALTER TABLE background_jobs ENABLE ELECTRIC;


/* Set up a trigger that will notify the appropriate API and perform
 * the work required to process the submitted job. The API should then
 * update the table accordingly with the processing status
 */

-- When a job is submitted, notify the appropriate API to process it
CREATE OR REPLACE FUNCTION process_job()
RETURNS TRIGGER AS $$
DECLARE
    new_progress REAL;
BEGIN
  IF NEW.completed = false AND NEW.cancelled = false THEN
    PERFORM pg_sleep(1);
    new_progress := GREATEST(0, LEAST(1, NEW.progress + random()));
    UPDATE public.background_jobs SET "progress" = new_progress WHERE "id" = NEW.id;
    IF new_progress == 1 THEN
      UPDATE public.background_jobs
      SET "completed" = true,
          "result" = '{"message": "success"}'::JSONB
      WHERE "id" = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;


-- Create a trigger to execute the function on INSERT into "background_jobs" table
CREATE TRIGGER "process_job_trigger"
AFTER INSERT ON background_jobs
FOR EACH ROW
EXECUTE FUNCTION process_job();

-- Create a trigger to keep executing the processing function as progress changes
CREATE TRIGGER "keep_processing_job_trigger"
AFTER UPDATE OF progress ON background_jobs
FOR EACH ROW
EXECUTE FUNCTION process_job();

-- Enable the triggers on the tables
ALTER TABLE background_jobs ENABLE ALWAYS TRIGGER process_job_trigger;
ALTER TABLE background_jobs ENABLE ALWAYS TRIGGER keep_processing_job_trigger;
