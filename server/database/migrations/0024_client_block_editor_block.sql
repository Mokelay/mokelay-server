ALTER TABLE "docs_client_block" ADD COLUMN IF NOT EXISTS "editor_block" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_docs_client_block_editor_block" ON "docs_client_block" USING btree ("editor_block");
