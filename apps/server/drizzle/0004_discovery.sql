ALTER TABLE "assumptions" ADD COLUMN "kind" text DEFAULT 'assumption' NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "gate" text DEFAULT 'assessment' NOT NULL;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "allow_comment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "comment" text;