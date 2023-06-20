CREATE TABLE "stars" (
  "id" TEXT NOT NULL,
  "avatar_url" TEXT NOT NULL,
  "name" TEXT,
  "starred_at" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  CONSTRAINT "stars_pkey" PRIMARY KEY ("id")
) WITHOUT ROWID;
