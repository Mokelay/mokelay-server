ALTER TABLE "pages" ALTER COLUMN "uuid" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "uuid" SET DATA TYPE varchar(128) USING "uuid"::text;--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "uuid" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_uuid_slug_check" CHECK (
	char_length("uuid") BETWEEN 1 AND 128
	AND "uuid" !~ '[^a-z0-9_-]'
);
