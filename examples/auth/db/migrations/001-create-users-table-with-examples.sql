CREATE TYPE user_role AS ENUM ('user', 'admin');

create table users (
  id int primary key generated always as identity,
  name text not null,
  password text not null, -- Don't do this in production! Passwords should be hashed and salted.
  org_id int,
  role user_role not null default 'user',
  CHECK (org_id IS NOT NULL OR role = 'admin')
);

insert into
  users (name, password, org_id)
values
  ('Alice', 'alice42', 1),
  ('Bob', 'bob42', 1),
  ('Charlie', 'charlie42', 1),
  ('David', 'david42', 2),
  ('Eve', 'eve42', 2),
  ('Frank', 'frank42', 2);

insert into
  users (name, password, role)
values
  ('Admin', 'admin42', 'admin');
