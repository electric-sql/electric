CREATE TABLE IF NOT EXISTS "related_issue" (
    "id" UUID NOT NULL,
    "issue_id_1" UUID NOT NULL,
    "issue_id_2" UUID NOT NULL,
    CONSTRAINT "related_issue_pkey" PRIMARY KEY ("id"),
    FOREIGN KEY (issue_id_1) REFERENCES issue(id),
    FOREIGN KEY (issue_id_2) REFERENCES issue(id)
);
ALTER TABLE related_issue ENABLE ELECTRIC;
