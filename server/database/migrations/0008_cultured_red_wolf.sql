CREATE TABLE "datasources" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" varchar(8) NOT NULL,
	"alias" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "datasources_uuid_unique" UNIQUE("uuid")
);
