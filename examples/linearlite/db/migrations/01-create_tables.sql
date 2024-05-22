-- Create the tables for the linearlite example
CREATE TABLE IF NOT EXISTS "profile" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "created" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "project" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "modified" TIMESTAMPTZ NOT NULL,
    "created" TIMESTAMPTZ NOT NULL,
    "kanbanorder" TEXT NOT NULL,
    CONSTRAINT "project_pkey" PRIMARY KEY ("id"),
    FOREIGN KEY (user_id) REFERENCES "profile"(id) DEFERRABLE
);

CREATE TABLE IF NOT EXISTS "issue" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,    
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "modified" TIMESTAMPTZ NOT NULL,
    "created" TIMESTAMPTZ NOT NULL,
    "kanbanorder" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    CONSTRAINT "issue_pkey" PRIMARY KEY ("id"),
    FOREIGN KEY (user_id) REFERENCES "profile"(id) DEFERRABLE,
    FOREIGN KEY (project_id) REFERENCES project(id) DEFERRABLE
);

CREATE TABLE  IF NOT EXISTS "comment" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "comment_pkey" PRIMARY KEY ("id"),
    FOREIGN KEY (user_id) REFERENCES "profile"(id) DEFERRABLE,
    FOREIGN KEY (issue_id) REFERENCES issue(id) DEFERRABLE
);

ELECTRIC GRANT READ
  ON "profile"
  TO AUTHENTICATED;

ELECTRIC GRANT ALL
  ON "profile"
  TO ("profile", 'owner');

ELECTRIC ASSIGN ("profile", 'owner')
  TO "profile".user_id;

ELECTRIC GRANT ALL
  ON "project"
  TO ("project", 'owner');

ELECTRIC ASSIGN ("project", 'owner')
  TO "project".user_id;

ELECTRIC GRANT READ
  ON "issue"
  TO ("project", 'owner');

ELECTRIC GRANT READ
  ON "comment"
  TO ("project", 'owner');


-- ⚡
-- Electrify the tables
ALTER TABLE "profile" ENABLE ELECTRIC;
ALTER TABLE "project" ENABLE ELECTRIC;
ALTER TABLE "issue" ENABLE ELECTRIC;
ALTER TABLE "comment" ENABLE ELECTRIC;
