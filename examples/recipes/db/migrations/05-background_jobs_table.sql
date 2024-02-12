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


/* Set up a trigger that will notify the appropriate service and perform
 * the work required to process the submitted job. The service should then
 * update the table accordingly with the progress and finally the result
 */

-- When a job is submitted, notify the appropriate service to process it
CREATE OR REPLACE FUNCTION process_job()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.completed = false AND NEW.cancelled = false THEN
    PERFORM pg_notify('process_background_job', row_to_json(NEW)::TEXT);
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;


-- Create a trigger to execute the function on INSERT into "background_jobs" table
CREATE TRIGGER "process_job_trigger"
AFTER INSERT ON background_jobs
FOR EACH ROW
EXECUTE FUNCTION process_job();

-- Enable the triggers on the tables
ALTER TABLE background_jobs ENABLE ALWAYS TRIGGER process_job_trigger;
