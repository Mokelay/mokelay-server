CREATE TABLE "api_domains" (
	"uuid" varchar(128) PRIMARY KEY NOT NULL,
	"alias" varchar(120) NOT NULL,
	"host" text NOT NULL,
	CONSTRAINT "api_domains_host_unique" UNIQUE("host")
);
--> statement-breakpoint
INSERT INTO "api_domains" ("uuid", "alias", "host")
VALUES ('mokelay', 'Mokelay 域名', 'https://api.mokelay.com')
ON CONFLICT ("uuid") DO NOTHING;
