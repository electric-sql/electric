CREATE TABLE "beers" (
  "id" TEXT NOT NULL,
  "star_id" TEXT,
  CONSTRAINT "beers_star_id_fkey" FOREIGN KEY ("star_id") REFERENCES "stars" ("id"),
  CONSTRAINT "beers_pkey" PRIMARY KEY ("id")
);
