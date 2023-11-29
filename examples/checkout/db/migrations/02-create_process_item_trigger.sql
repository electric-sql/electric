DROP TRIGGER IF EXISTS "process_order_trigger" ON "public"."orders";
DROP FUNCTION IF EXISTS call_process_order_trigger();

CREATE FUNCTION call_process_order_trigger() RETURNS trigger AS $$
BEGIN
  UPDATE "public"."orders" SET "status" = 'submitted' WHERE "id" = new.id;
  PERFORM net.http_post(
    'http://kong:8000/functions/v1/process',
    ('{"id": "' || new.id || '"}')::jsonb,
    '{}'::jsonb,
    '{"Content-type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q"}'::jsonb
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "process_order_trigger" AFTER INSERT
ON "public"."orders" FOR EACH ROW
EXECUTE FUNCTION call_process_order_trigger();

ALTER TABLE "public"."orders" ENABLE ALWAYS TRIGGER process_order_trigger;
