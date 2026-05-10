CREATE TABLE "orchestration_api_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_uuid" varchar(128) NOT NULL,
	"version" integer NOT NULL,
	"api_json" jsonb NOT NULL,
	"builder_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestration_apis" (
	"uuid" varchar(128) PRIMARY KEY NOT NULL,
	"alias" varchar(255) DEFAULT '' NOT NULL,
	"method" varchar(16) DEFAULT 'GET' NOT NULL,
	"draft_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_json" jsonb NOT NULL,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "orchestration_api_versions_api_uuid_version_unique" ON "orchestration_api_versions" USING btree ("api_uuid","version");