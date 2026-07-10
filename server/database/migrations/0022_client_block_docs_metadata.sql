ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "source_package" varchar(128) DEFAULT 'mokelay-editor' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "component_name" varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "tool_symbol" varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "editor_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "toolbox_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "registration" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "default_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "save_schema" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_docs_client_block_editor_enabled" ON "docs_client_block" USING btree ("editor_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_docs_client_block_toolbox_visible" ON "docs_client_block" USING btree ("toolbox_visible");
