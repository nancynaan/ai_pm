CREATE TABLE "baseline_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"confluence_page_id" text,
	"confluence_version" integer,
	"content_storage" text NOT NULL,
	"content_text" text NOT NULL,
	"data" jsonb,
	"checksum" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baseline_artifacts_project_type" UNIQUE("project_id","type")
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"system" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text,
	"external_key" text,
	"external_version" integer,
	"payload_hash" text,
	"last_action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_log_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "baseline_digest" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "baseline_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "baseline_artifacts" ADD CONSTRAINT "baseline_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;