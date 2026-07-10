CREATE TABLE "docs_client_action" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"uuid" varchar(128) NOT NULL,
	"action_name" varchar(128) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"action_type" varchar(32) DEFAULT 'action' NOT NULL,
	"category" varchar(64) DEFAULT 'custom' NOT NULL,
	"source_kind" varchar(64) NOT NULL,
	"source_package" varchar(128) NOT NULL,
	"source_file" text DEFAULT '' NOT NULL,
	"executor_name" varchar(128) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"input_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"node_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runtime_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_client_action_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "docs_client_action_name_unique" UNIQUE("action_name")
);
--> statement-breakpoint
CREATE INDEX "idx_docs_client_action_category" ON "docs_client_action" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "idx_docs_client_action_source_kind" ON "docs_client_action" USING btree ("source_kind");
--> statement-breakpoint
CREATE TABLE "docs_client_processor" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"uuid" varchar(128) NOT NULL,
	"processor_name" varchar(128) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"category" varchar(64) DEFAULT 'custom' NOT NULL,
	"source_kind" varchar(64) NOT NULL,
	"source_package" varchar(128) NOT NULL,
	"source_file" text DEFAULT '' NOT NULL,
	"executor_name" varchar(128) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"input_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"param_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runtime_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_client_processor_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "docs_client_processor_name_unique" UNIQUE("processor_name")
);
--> statement-breakpoint
CREATE INDEX "idx_docs_client_processor_category" ON "docs_client_processor" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "idx_docs_client_processor_source_kind" ON "docs_client_processor" USING btree ("source_kind");
