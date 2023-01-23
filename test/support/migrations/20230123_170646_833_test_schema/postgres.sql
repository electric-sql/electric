
CREATE TABLE public.parent (
  id bigint PRIMARY KEY,
  value text,
  other bigint DEFAULT 0);
ALTER TABLE public.parent REPLICA IDENTITY FULL;

CREATE TABLE public.items (
  value text PRIMARY KEY);
ALTER TABLE public.items REPLICA IDENTITY FULL;

CREATE TABLE public.child (
  id bigint PRIMARY KEY,
  parent bigint NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id) MATCH SIMPLE);
ALTER TABLE public.child REPLICA IDENTITY FULL;
