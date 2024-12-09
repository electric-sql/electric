-- Basic todos table.
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Insert some todos to get started.
INSERT INTO todos (
  id,
  title,
  completed,
  created_at
)
SELECT
  gen_random_uuid(),
  'Get stuff done',
  '0',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT * FROM todos
);
