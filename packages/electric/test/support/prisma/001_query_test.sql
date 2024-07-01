CREATE TABLE public.with_constraint (
  id text PRIMARY KEY,
  value TEXT NOT NULL,
  limited int4 CONSTRAINT limited_check CHECK (limited < 100)
);

CREATE INDEX with_constraint_idx ON public.with_constraint (value);

