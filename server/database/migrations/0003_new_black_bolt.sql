CREATE TABLE "apis" (
	"uuid" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"method" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"api_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
