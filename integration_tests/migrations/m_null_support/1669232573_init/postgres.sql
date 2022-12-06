/*
Manually generated
*/
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.items_full (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) NOT NULL,
    content_b VARCHAR(64),
    intvalue integer
);

ALTER TABLE public.items_full REPLICA IDENTITY FULL;

CREATE TABLE public.items_default (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) NOT NULL,
    content_b VARCHAR(64),
    intvalue integer
);

ALTER TABLE public.items_default REPLICA IDENTITY DEFAULT;
