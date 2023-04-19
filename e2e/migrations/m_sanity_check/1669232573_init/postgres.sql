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

CREATE TABLE public.other_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) DEFAULT '' NOT NULL,
    content_b VARCHAR(64) DEFAULT ''
);

ALTER TABLE public.other_items REPLICA IDENTITY FULL;
