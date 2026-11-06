CREATE TABLE "presentations" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"input_hash" text NOT NULL,
	"draft" jsonb NOT NULL,
	"deck" jsonb NOT NULL,
	"attachment_status" text,
	"attachment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;