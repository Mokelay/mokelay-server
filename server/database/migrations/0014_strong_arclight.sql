ALTER TABLE "block_component_docs" DROP CONSTRAINT IF EXISTS "block_component_docs_pkey";--> statement-breakpoint
ALTER TABLE "block_component_docs" ADD COLUMN "id" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "block_component_docs" ADD CONSTRAINT "block_component_docs_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "block_component_docs" ADD CONSTRAINT "block_component_docs_uuid_unique" UNIQUE("uuid");
