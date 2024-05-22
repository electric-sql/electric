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
    "public" BOOLEAN NOT NULL,
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

-- Every authenticated user can see everyone's profile
ELECTRIC GRANT READ
  ON "profile"
  TO AUTHENTICATED;


-- Every authenticated user can see public projects and
-- their issues and comments, and create issues/comments
-- within them
ELECTRIC ASSIGN 'public_project_member'
  TO "profile".id;

ELECTRIC GRANT READ
  ON "project"
  TO 'public_project_member'
  WHERE (ROW.public = 'true');

ELECTRIC GRANT READ
  ON "issue"
  TO 'public_project_member';

ELECTRIC GRANT WRITE
  ON "issue"
  TO 'public_project_member'
  WHERE ( NEW.user_id = AUTH.user_id );

ELECTRIC GRANT READ
  ON "comment"
  TO 'public_project_member';

ELECTRIC GRANT WRITE
  ON "comment"
  TO 'public_project_member'
  WHERE ( NEW.user_id = AUTH.user_id );


-- Profile owner should have full control
ELECTRIC ASSIGN ("profile", 'owner')
  TO "profile".id;

ELECTRIC GRANT ALL
  ON "profile"
  TO ("profile", 'owner');


-- Every authenticated user can create a private project
ELECTRIC GRANT INSERT
  ON "project"
  TO AUTHENTICATED
  WHERE (
    NEW.user_id = AUTH.user_id AND
    NEW.public = 'false'
  );

-- Project owner should have full control
-- over project, and read access over all its
-- issues and comments
ELECTRIC ASSIGN ("project", 'owner')
  TO "project".user_id;

ELECTRIC GRANT ALL
  ON "project"
  TO ("project", 'owner');

ELECTRIC GRANT READ
  ON "issue"
  TO ("project", 'owner');

ELECTRIC GRANT READ
  ON "comment"
  TO ("project", 'owner');


-- Issue owner should have full control
ELECTRIC ASSIGN ("issue", 'owner')
  TO "issue".user_id;

ELECTRIC GRANT ALL
  ON "issue"
  TO ("issue", 'owner');


-- Comment owner should have full control
ELECTRIC ASSIGN ("comment", 'owner')
  TO "comment".user_id;

ELECTRIC GRANT ALL
  ON "comment"
  TO ("comment", 'owner');  



-- ⚡
-- Electrify the tables
ALTER TABLE "profile" ENABLE ELECTRIC;
ALTER TABLE "project" ENABLE ELECTRIC;
ALTER TABLE "issue" ENABLE ELECTRIC;
ALTER TABLE "comment" ENABLE ELECTRIC;
