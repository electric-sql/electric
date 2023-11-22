DROP TRIGGER IF EXISTS "process_item_trigger" ON "public"."items";
DROP FUNCTION IF EXISTS call_process_item_trigger();

CREATE FUNCTION call_process_item_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    'http://kong:8000/functions/v1/process',
    ('{"id": "' || new.id || '"}')::jsonb,
    '{}'::jsonb,
    '{"Content-type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q"}'::jsonb
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "process_item_trigger" AFTER INSERT
ON "public"."items" FOR EACH ROW
EXECUTE FUNCTION call_process_item_trigger();

ALTER TABLE "public"."items" ENABLE ALWAYS TRIGGER process_item_trigger;
