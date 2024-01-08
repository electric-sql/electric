-- for use via psql only

ALTER TABLE public.with_constraint ENABLE ELECTRIC;
ALTER TABLE public.checked ENABLE ELECTRIC;
-- NOTE: `interesting` can't currently be electrified as it contains columns of
-- types we currently (as of 09/2023) don't support
ALTER TABLE public.interesting ENABLE ELECTRIC;
ALTER TABLE public.pointy ENABLE ELECTRIC;
ALTER TABLE public.pointy2 ENABLE ELECTRIC;
ALTER TABLE public.oses ENABLE ELECTRIC;
