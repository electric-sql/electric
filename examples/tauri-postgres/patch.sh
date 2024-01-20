#!/bin/bash

# This is a script that solves inconsistencies for the tauri linearlite demo
# At the end of the demo, this file should be empty

# sed -i 's/WITHOUT ROWID//g' src/generated/client/migrations.ts
# sed -i '' 's/WITHOUT ROWID//g' src/generated/client/migrations.ts
sed 's/WITHOUT ROWID//g' src/generated/client/migrations.ts > tmpfile && mv tmpfile src/generated/client/migrations.ts
sleep 1
# sed 's/\\"embeddings\\" TEXT NOT NULL/\\"embeddings\\" vector(768)/g' src/generated/client/migrations.ts > tmpfile && mv tmpfile src/generated/client/migrations.ts
sed '4i\
      "CREATE EXTENSION vector;",
' src/generated/client/migrations.ts > tmpfile && mv tmpfile src/generated/client/migrations.ts
sleep 1

sed '39i\
,\`CREATE TABLE  IF NOT EXISTS "document" (id BIGSERIAL PRIMARY KEY,"issue_id" TEXT NOT NULL,"embeddings" vector(768),UNIQUE (issue_id),FOREIGN KEY (issue_id) REFERENCES issue(id) ON DELETE CASCADE);\`, \`CREATE OR REPLACE FUNCTION function_copy_embeddings() RETURNS TRIGGER AS $$ BEGIN IF NEW.embeddings IS NOT NULL THEN INSERT INTO document(issue_id,embeddings) VALUES(new.id, new.embeddings::vector) ON CONFLICT (issue_id) DO UPDATE SET embeddings = excluded.embeddings; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;\`, \`CREATE TRIGGER trig_copy_embeddings AFTER INSERT ON issue FOR EACH ROW EXECUTE PROCEDURE function_copy_embeddings();\`,
' src/generated/client/migrations.ts > tmpfile && mv tmpfile src/generated/client/migrations.ts
