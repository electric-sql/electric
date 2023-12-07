INSERT INTO users (user_id, first_name, last_name, created_at)
VALUES
  (gen_random_uuid(), 'Ari', 'Siever', NOW()),
  (gen_random_uuid(), 'Oder', 'Siever', NOW());