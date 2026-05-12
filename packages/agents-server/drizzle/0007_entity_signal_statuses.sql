ALTER TABLE "entities" DROP CONSTRAINT "chk_entities_status";
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "chk_entities_status" CHECK ("entities"."status" IN ('spawning', 'running', 'idle', 'paused', 'stopping', 'stopped', 'killed'));
