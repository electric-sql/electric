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

