CREATE TABLE "docs_server_controller" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"uuid" varchar(128) NOT NULL,
	"function_name" varchar(128) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"category" varchar(64) DEFAULT 'custom' NOT NULL,
	"source_kind" varchar(64) NOT NULL,
	"source_package" varchar(128) NOT NULL,
	"source_file" text DEFAULT '' NOT NULL,
	"executor_name" varchar(128) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"input_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"node_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runtime_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_server_controller_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "docs_server_controller_function_name_unique" UNIQUE("function_name")
);
--> statement-breakpoint
CREATE INDEX "idx_docs_server_controller_category" ON "docs_server_controller" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_docs_server_controller_source_kind" ON "docs_server_controller" USING btree ("source_kind");
