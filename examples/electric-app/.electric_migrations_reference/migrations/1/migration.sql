CREATE TABLE "items" (
  "id" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "i" INTEGER,
  "i8" INTEGER,
  "r" REAL,
  "f" REAL,
  "Vc" TEXT,
  "b-oo-lean" INTEGER NOT NULL,
  CONSTRAINT "items_pkey" PRIMARY KEY ("id")
) WITHOUT ROWID;


CREATE TABLE "_weird_Name" (
  "id" TEXT NOT NULL,
  "item" TEXT,
  "foo bar" TEXT,
  CONSTRAINT "_weird_Name_item_fkey" FOREIGN KEY ("item") REFERENCES "items" ("id"),
  CONSTRAINT "_weird_Name_pkey" PRIMARY KEY ("id")
) WITHOUT ROWID;


CREATE TABLE "public.trees" (
  "id" TEXT NOT NULL,
  "wood" TEXT NOT NULL,
  " Knock on (-wood-)" INTEGER NOT NULL,
  CONSTRAINT "public.trees_pkey" PRIMARY KEY ("id")
) WITHOUT ROWID;
