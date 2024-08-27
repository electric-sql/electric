create table users (
  id int primary key generated always as identity,
  name text not null,
  org_id int not null
);

insert into
  users (name, org_id)
values
  ('Alice', 1),
  ('Bob', 1),
  ('Charlie', 1),
  ('David', 2),
  ('Eve', 2),
  ('Frank', 2);
