-- Create the tables for the Ionic example
CREATE TABLE IF NOT EXISTS "appointments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "comments" TEXT NOT NULL,
    "start" TIMESTAMP NOT NULL,
    "end" TIMESTAMP NOT NULL,
    "cancelled" BOOLEAN NOT NULL,
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- ⚡
-- Electrify the tables
ALTER TABLE appointments ENABLE ELECTRIC;
