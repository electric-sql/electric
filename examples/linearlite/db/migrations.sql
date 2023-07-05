-- CreateTable
CREATE TABLE IF NOT EXISTS "issue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT NOT NULL,
    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE  IF NOT EXISTS "comment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "created_at" TIMESTAMP NOT NULL,
    FOREIGN KEY (author_id) REFERENCES "user"(id),
    FOREIGN KEY (issue_id) REFERENCES issue(id),
    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);
--
CALL electric.electrify('issue');
CALL electric.electrify('user');
CALL electric.electrify('comment');