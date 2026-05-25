CREATE TABLE "apis_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_uuid" varchar(128) NOT NULL,
	"name" varchar(120) NOT NULL,
	"method" varchar(16) NOT NULL,
	"status" varchar(32) NOT NULL,
	"api_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
