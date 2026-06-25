CREATE TABLE "layouts" (
	"uuid" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"layout_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "default_layout_uuid" varchar(128);--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "app_uuid" varchar(8);--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "layout_uuid" varchar(128);
