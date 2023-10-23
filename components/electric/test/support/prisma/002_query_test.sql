CREATE TABLE public.checked (
  id text PRIMARY KEY,
  value TEXT NOT NULL,
  count int4 CONSTRAINT count_check CHECK ((count < 100) AND (count > 10)),
  number int4,
  CONSTRAINT combined CHECK (number + count < 200)
);

CREATE SCHEMA IF NOT EXISTS other;

CREATE TABLE other.with_constraint (id text PRIMARY KEY, value TEXT NOT NULL, limited int4 CHECK (limited < 100));

CREATE TABLE public.interesting (
  id uuid PRIMARY KEY,
  value varchar(255) DEFAULT 'something',
  iii int8[][3] NOT NULL,
  big int8, 
  small int2, 
  nn numeric(12, 6),
  ts timestamptz DEFAULT now(),
  updated timestamptz(3)
);

CREATE UNIQUE INDEX interesting_idx ON public.interesting USING btree (value DESC NULLS LAST, ts);

CREATE TABLE public.pointy (
  id text PRIMARY KEY,
  checked_id text NOT NULL REFERENCES public.checked (id)
);

CREATE UNIQUE INDEX checked_fk_idx ON public.checked (id, value);

CREATE TABLE public.pointy2 (
  id text PRIMARY KEY,
  checked_id text NOT NULL,
  checked_value text NOT NULL,
  amount smallint,
  code smallint,
  FOREIGN KEY (checked_id, checked_value) REFERENCES public.checked (id, value),
  UNIQUE (amount, code)
);


