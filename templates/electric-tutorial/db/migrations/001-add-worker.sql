CREATE TABLE workers (
    id uuid primary key,
    last_seen timestamp with time zone not null default now(),
    status text not null check (status in ('idle', 'working')),
    num_jobs_completed int not null default 0,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    current_job_id bigint
);
