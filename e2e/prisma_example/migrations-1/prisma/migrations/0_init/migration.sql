-- this is a base line migration
-- https://www.prisma.io/docs/guides/migrate/developing-with-prisma-migrate/add-prisma-migrate-to-a-project#baseline-your-production-environment
-- CreateTable
CREATE TABLE "entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content" VARCHAR NOT NULL,
    "content_b" TEXT,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owned_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "electric_user_id" TEXT NOT NULL,
    "content" VARCHAR NOT NULL,

    CONSTRAINT "owned_entries_pkey" PRIMARY KEY ("id")
);

