CREATE TABLE "apps" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" varchar(8) DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8) NOT NULL,
	"alias" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "apps_uuid_unique" UNIQUE("uuid")
);
