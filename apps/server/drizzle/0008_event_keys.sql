ALTER TABLE "run_events" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_key" UNIQUE("run_id","key");