ALTER TABLE "pages" ADD COLUMN "sub_page" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "quotes" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_pages_sub_page" ON "pages" USING btree ("sub_page");
--> statement-breakpoint
CREATE TABLE "page_reference_graph_state" (
	"id" integer DEFAULT 1 PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_reference_graph_state_singleton" CHECK ("page_reference_graph_state"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "page_reference_graph_state" ("id", "revision", "version") VALUES (1, 0, 0) ON CONFLICT ("id") DO NOTHING;
