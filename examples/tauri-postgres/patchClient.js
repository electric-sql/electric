import { readFileSync, writeFileSync } from "fs";
import path from "path";
import * as url from "url";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const migrationsFile = path.join(dirname, "src/generated/client/migrations.ts");
const migrationsText = readFileSync(migrationsFile, "utf8");
const migrations = JSON.parse(migrationsText.slice("export default ".length));

const newMigrations = [
  {
    ...migrations[0],
    statements: [
      "CREATE EXTENSION vector;",
      ...migrations[0].statements.map((statement) => {
        return statement.replace("WITHOUT ROWID", "");
      }),
      `
        CREATE TABLE IF NOT EXISTS "document" (
          id BIGSERIAL PRIMARY KEY,
          "issue_id" TEXT NOT NULL,
          "embeddings" vector(768),
          UNIQUE (issue_id),
          FOREIGN KEY (issue_id) REFERENCES issue(id)
        );
      `,
      `
        CREATE OR REPLACE FUNCTION function_copy_embeddings() RETURNS TRIGGER AS 
        $$
        BEGIN
          IF NEW.embeddings IS NOT NULL
          THEN 
            INSERT INTO document(issue_id,embeddings)
            VALUES (new.id, new.embeddings::vector)
            ON CONFLICT (issue_id) DO
              UPDATE SET embeddings = excluded.embeddings;
          END IF;
          RETURN NEW;
        END;
        $$
        LANGUAGE plpgsql;
      `,
      `
        CREATE TRIGGER trig_copy_embeddings
        AFTER INSERT ON issue 
          FOR EACH ROW EXECUTE PROCEDURE function_copy_embeddings();
      `,
    ],
  },
];

writeFileSync(
  migrationsFile,
  `export default ${JSON.stringify(newMigrations, null, 2)}`
);
