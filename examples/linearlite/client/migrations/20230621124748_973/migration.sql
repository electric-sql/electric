CREATE TABLE "issue" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
) WITHOUT ROWID;
