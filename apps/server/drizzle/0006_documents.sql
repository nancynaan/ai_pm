CREATE TABLE "document_sets" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"fa_number" integer NOT NULL,
	"input_hash" text,
	"draft" jsonb,
	"write_mode" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sets_fa_number_unique" UNIQUE("fa_number")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"figures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"confluence_page_id" text,
	"confluence_version" integer,
	"url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_run_type" UNIQUE("run_id","type")
);
--> statement-breakpoint
ALTER TABLE "document_sets" ADD CONSTRAINT "document_sets_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;