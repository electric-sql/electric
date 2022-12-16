/*
ElectricDB Migration
{"metadata": {"title": "init", "name": "1669232573_init"}}
*/

CREATE TABLE IF NOT EXISTS public.items (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    content_b TEXT
);

CREATE TABLE IF NOT EXISTS public.other_items (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    content_b TEXT
);

