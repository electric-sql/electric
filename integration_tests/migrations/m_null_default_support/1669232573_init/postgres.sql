/*
Manually generated
*/
CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE public.items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) NOT NULL,
    content_text_null VARCHAR(64),
    content_text_null_default VARCHAR(64) DEFAULT '',
    intvalue_null integer,
    intvalue_null_default integer DEFAULT 10
);

ALTER TABLE public.items REPLICA IDENTITY FULL;

CREATE OR REPLACE TRIGGER insert_on_conflict_for_logical_trigger
BEFORE INSERT ON public.items
FOR EACH ROW
WHEN (pg_trigger_depth() < 1)
EXECUTE PROCEDURE upsert_from_replication_stream_insert();

ALTER TABLE public.items enable replica trigger insert_on_conflict_for_logical_trigger;

