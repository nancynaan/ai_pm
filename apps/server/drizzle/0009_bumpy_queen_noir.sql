CREATE TABLE "backlog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"local_id" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"priority" text,
	"ai_estimate" double precision,
	"requirement_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jira_key" text,
	"url" text,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backlog_items_run_local" UNIQUE("run_id","local_id")
);
--> statement-breakpoint
CREATE TABLE "backlog_sets" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"input_hash" text NOT NULL,
	"draft" jsonb NOT NULL,
	"write_mode" text,
	"confluence_url" text,
	"confluence_status" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backlog_items" ADD CONSTRAINT "backlog_items_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backlog_sets" ADD CONSTRAINT "backlog_sets_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;