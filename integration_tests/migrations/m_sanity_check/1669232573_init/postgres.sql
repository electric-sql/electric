/*
Manually generated
*/
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) DEFAULT '' NOT NULL,
    content_b VARCHAR(64) DEFAULT ''
);

ALTER TABLE public.items REPLICA IDENTITY FULL;

CREATE OR REPLACE TRIGGER insert_on_conflict_for_logical_trigger
BEFORE INSERT ON public.items
FOR EACH ROW
WHEN (pg_trigger_depth() < 1)
EXECUTE PROCEDURE upsert_from_replication_stream_insert();

ALTER TABLE public.items enable replica trigger insert_on_conflict_for_logical_trigger;

CREATE TABLE public.other_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) DEFAULT '' NOT NULL,
    content_b VARCHAR(64) DEFAULT ''
);

ALTER TABLE public.other_items REPLICA IDENTITY FULL;

CREATE OR REPLACE TRIGGER insert_on_conflict_for_logical_trigger
BEFORE INSERT ON public.other_items
FOR EACH ROW
WHEN (pg_trigger_depth() < 1)
EXECUTE PROCEDURE upsert_from_replication_stream_insert();

ALTER TABLE public.other_items enable replica trigger insert_on_conflict_for_logical_trigger;