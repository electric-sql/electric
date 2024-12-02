-- Add a version column for the combine on read pattern.
ALTER TABLE todos ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

-- Bump the version on update.
CREATE OR REPLACE FUNCTION bump_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_version_trigger
BEFORE UPDATE ON todos
FOR EACH ROW
EXECUTE PROCEDURE bump_version();
