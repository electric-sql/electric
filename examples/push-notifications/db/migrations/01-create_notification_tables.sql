-- Create a users table.
CREATE TABLE IF NOT EXISTS users (
  "user_id" UUID PRIMARY KEY NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL
);


-- Create a notification templates table.
CREATE TABLE IF NOT EXISTS notification_templates (
  "template_id" UUID PRIMARY KEY NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "message" TEXT NOT NULL,
  "action" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL
);


-- Create a notifications table.
CREATE TABLE IF NOT EXISTS notifications (
  "notification_id" UUID PRIMARY KEY NOT NULL,
  "template_id" UUID NOT NULL REFERENCES notification_templates,
  "source_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "deliver_after" TIMESTAMPTZ,
  "delivered_at" TIMESTAMPTZ,
  "read_at" TIMESTAMPTZ,
  FOREIGN KEY("source_id") REFERENCES users("user_id") ON DELETE CASCADE,
  FOREIGN KEY("target_id") REFERENCES users("user_id") ON DELETE CASCADE
);

-- ⚡
-- Electrify all the tables
ALTER TABLE users ENABLE ELECTRIC;
ALTER TABLE notification_templates ENABLE ELECTRIC;
ALTER TABLE notifications ENABLE ELECTRIC;